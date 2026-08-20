//! Linux 会话支持：xdg-desktop-portal 后端。
//!
//! Wayland 合成器不允许应用直接注册全局热键或直接抓取屏幕，因此：
//! - 全局热键走 `org.freedesktop.portal.GlobalShortcuts`
//!   （GNOME/KDE 均实现；首次绑定时桌面环境会弹出确认窗口，之后静默生效）。
//! - 屏幕截图走 `org.freedesktop.portal.Screenshot`（整屏截图后按区域裁剪），
//!   Wayland / X11 统一使用（避免 xcap 带来的 pipewire/xcb C 构建依赖）。
//!   授权状态持久化在 `org.freedesktop.impl.portal.PermissionStore`
//!   （table = "screenshot", id = "screenshot"）。
//!
//! X11 会话的热键不走本模块：继续用 tauri-plugin-global-shortcut（X11 下可用）。
//!
//! 本模块内部维护一个专用线程（自带 tokio runtime）承载所有 D-Bus 异步操作，
//! 对外暴露同步阻塞 API，方便热键注册 / 截图等既有同步调用点直接使用。

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{mpsc, OnceLock};
use std::time::Duration;

use futures::StreamExt;
use tauri::AppHandle;
use zbus::fdo::DBusProxy;
use zbus::message::Type as MsgType;
use zbus::zvariant::{OwnedObjectPath, OwnedValue, Value};
use zbus::{Connection, MatchRule, MessageStream};

const PORTAL_DEST: &str = "org.freedesktop.portal.Desktop";
const PORTAL_PATH: &str = "/org/freedesktop/portal/desktop";
const GLOBAL_SHORTCUTS_IFACE: &str = "org.freedesktop.portal.GlobalShortcuts";
const SCREENSHOT_IFACE: &str = "org.freedesktop.portal.Screenshot";
const REQUEST_IFACE: &str = "org.freedesktop.portal.Request";
const SESSION_IFACE: &str = "org.freedesktop.portal.Session";
const PERMISSION_DEST: &str = "org.freedesktop.impl.portal.PermissionStore";
const PERMISSION_PATH: &str = "/org/freedesktop/impl/portal/PermissionStore";
const SCREENSHOT_TABLE: &str = "screenshot";
const SCREENSHOT_PERM_ID: &str = "screenshot";

/// 门户热键触发后要执行的 Kivio 动作。
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum LinuxHotkeyAction {
    Translator,
    Chat,
    CloseChat,
    ScreenshotTranslate,
    ScreenshotTranslateText,
    ScreenshotReplace,
    ScreenshotAnnotate,
    Lens,
}

/// 一条要注册到门户的全局热键。
pub struct PortalShortcutEntry {
    /// 稳定的快捷键 id（GNOME 按 app + id 持久化，改名会导致旧绑定残留）。
    pub id: &'static str,
    /// 门户 trigger 字符串，如 "Ctrl+Shift+A"。
    pub trigger: String,
    /// 展示在桌面环境快捷键设置里的描述。
    pub description: &'static str,
    pub action: LinuxHotkeyAction,
}

/// 当前是否为 Wayland 会话。
pub fn is_wayland_session() -> bool {
    if let Ok(session) = std::env::var("XDG_SESSION_TYPE") {
        if session.eq_ignore_ascii_case("wayland") {
            return true;
        }
        if session.eq_ignore_ascii_case("x11") {
            return false;
        }
    }
    std::env::var_os("WAYLAND_DISPLAY").is_some()
}

/// 本应用可能的 app id 列表（门户/权限存储按 app id 归属权限）。
/// 优先取 GIO_LAUNCHED_DESKTOP_FILE 的文件名（GNOME 实际使用的 app id），
/// 再补 bundle id 与 .desktop 名兜底。
pub fn app_id_candidates() -> Vec<String> {
    let mut ids: Vec<String> = Vec::new();
    if let Ok(desktop_file) = std::env::var("GIO_LAUNCHED_DESKTOP_FILE") {
        if let Some(base) = std::path::Path::new(&desktop_file)
            .file_name()
            .and_then(|n| n.to_str())
        {
            let id = base.strip_suffix(".desktop").unwrap_or(base).to_string();
            if !id.is_empty() {
                ids.push(id);
            }
        }
    }
    for fallback in ["kivio-desktop", "com.zmair.kivio"] {
        if !ids.iter().any(|s| s == fallback) {
            ids.push(fallback.to_string());
        }
    }
    ids
}

/// 把 Tauri/global-hotkey 风格的热键字符串转成门户 trigger（如 "CTRL+SHIFT+F10"）。
/// 解析失败（没有普通键）返回 None。
pub fn tauri_hotkey_to_portal_trigger(hotkey: &str) -> Option<String> {
    // GNOME 实现（xdg-desktop-portal-gnome portal_trigger_to_settings）按 "+" 拆分后
    // 用 strcmp 精确匹配大写修饰键：CTRL/SHIFT/ALT/NUM/LOGO，其余原样透传。
    let mut modifiers: Vec<&'static str> = Vec::new();
    let mut key: Option<String> = None;
    for raw_part in hotkey.trim().split('+') {
        let part = raw_part.trim();
        if part.is_empty() {
            continue;
        }
        match part.to_ascii_lowercase().as_str() {
            "commandorcontrol" | "cmdorctrl" | "command" | "cmd" | "control" | "ctrl" => {
                if !modifiers.contains(&"CTRL") {
                    modifiers.push("CTRL");
                }
            }
            "alt" | "option" => {
                if !modifiers.contains(&"ALT") {
                    modifiers.push("ALT");
                }
            }
            "shift" => {
                if !modifiers.contains(&"SHIFT") {
                    modifiers.push("SHIFT");
                }
            }
            // GNOME 映射表里 Super 对应 LOGO；写 SUPER 不在表内会被当普通键透传
            "super" | "meta" | "win" | "windows" | "mod" => {
                if !modifiers.contains(&"LOGO") {
                    modifiers.push("LOGO");
                }
            }
            _ => {
                key = Some(normalize_portal_key(part));
            }
        }
    }
    let key = key?;
    if key.is_empty() {
        return None;
    }
    let mut parts: Vec<String> = modifiers.iter().map(|m| m.to_string()).collect();
    parts.push(key);
    Some(parts.join("+"))
}

fn normalize_portal_key(part: &str) -> String {
    match part.to_ascii_lowercase().as_str() {
        "space" => "space".to_string(),
        "enter" | "return" => "Return".to_string(),
        "escape" | "esc" => "Escape".to_string(),
        "tab" => "Tab".to_string(),
        "backspace" => "BackSpace".to_string(),
        "delete" | "del" => "Delete".to_string(),
        "insert" => "Insert".to_string(),
        "home" => "Home".to_string(),
        "end" => "End".to_string(),
        "pageup" => "Page_Up".to_string(),
        "pagedown" => "Page_Down".to_string(),
        "up" => "Up".to_string(),
        "down" => "Down".to_string(),
        "left" => "Left".to_string(),
        "right" => "Right".to_string(),
        single if single.len() == 1 => single.to_ascii_lowercase(),
        other => other.to_string(), // F1..F35、Print 等原样透传
    }
}

// ---------------------------------------------------------------------------
// 门户运行时（专用线程 + tokio runtime，承载所有 D-Bus 会话）
// ---------------------------------------------------------------------------

enum PortalCmd {
    RegisterShortcuts {
        app: AppHandle,
        entries: Vec<PortalShortcutEntry>,
        reply: mpsc::SyncSender<Result<(), String>>,
    },
    Screenshot {
        reply: mpsc::SyncSender<Result<PathBuf, String>>,
    },
    PermissionGranted {
        reply: mpsc::SyncSender<bool>,
    },
    RequestPermission {
        reply: mpsc::SyncSender<Result<(), String>>,
    },
}

static CMD_TX: OnceLock<mpsc::Sender<PortalCmd>> = OnceLock::new();

fn runtime_tx() -> &'static mpsc::Sender<PortalCmd> {
    CMD_TX.get_or_init(|| {
        let (tx, rx) = mpsc::channel::<PortalCmd>();
        std::thread::Builder::new()
            .name("kivio-portal".to_string())
            .spawn(move || run_portal_runtime(rx))
            .expect("spawn linux portal runtime thread");
        tx
    })
}

fn run_portal_runtime(rx: mpsc::Receiver<PortalCmd>) {
    let rt = match tokio::runtime::Builder::new_multi_thread()
        .worker_threads(2)
        .enable_all()
        .thread_name("kivio-portal-tokio")
        .build()
    {
        Ok(rt) => rt,
        Err(err) => {
            eprintln!("[linux-portal] failed to build runtime: {err}");
            return;
        }
    };
    // 当前活跃的全局热键会话任务；重新注册时先 abort 旧会话（连接关闭后门户自动释放会话）
    let mut active_session: Option<tokio::task::JoinHandle<()>> = None;
    while let Ok(cmd) = rx.recv() {
        match cmd {
            PortalCmd::RegisterShortcuts {
                app,
                entries,
                reply,
            } => {
                if let Some(handle) = active_session.take() {
                    handle.abort();
                }
                let (phase_tx, phase_rx) = mpsc::sync_channel::<Result<(), String>>(1);
                let handle = rt.spawn(shortcut_session_task(app, entries, phase_tx));
                let outcome = phase_rx
                    .recv_timeout(Duration::from_secs(15))
                    .unwrap_or_else(|_| {
                        Err("[linux-portal] GlobalShortcuts session setup timed out".to_string())
                    });
                if outcome.is_ok() {
                    active_session = Some(handle);
                } else {
                    handle.abort();
                }
                let _ = reply.send(outcome);
            }
            PortalCmd::Screenshot { reply } => {
                rt.spawn(async move {
                    let result = portal_screenshot_inner().await;
                    let _ = reply.send(result);
                });
            }
            PortalCmd::PermissionGranted { reply } => {
                rt.spawn(async move {
                    let granted = permission_granted_inner().await;
                    let _ = reply.send(granted);
                });
            }
            PortalCmd::RequestPermission { reply } => {
                rt.spawn(async move {
                    let result = request_permission_inner().await;
                    let _ = reply.send(result);
                });
            }
        }
    }
}

// ---------------------------------------------------------------------------
// 对外同步 API
// ---------------------------------------------------------------------------

/// 通过门户注册全局热键。只等待「会话创建成功」（确认门户可用），
/// BindShortcuts 本身可能弹出桌面环境的确认窗口，在后台继续完成。
pub fn register_shortcuts(app: AppHandle, entries: Vec<PortalShortcutEntry>) -> Result<(), String> {
    let (reply_tx, reply_rx) = mpsc::sync_channel(1);
    if runtime_tx()
        .send(PortalCmd::RegisterShortcuts {
            app,
            entries,
            reply: reply_tx,
        })
        .is_err()
    {
        return Err("[linux-portal] portal runtime exited".to_string());
    }
    reply_rx
        .recv_timeout(Duration::from_secs(20))
        .unwrap_or_else(|_| Err("[linux-portal] hotkey registration timed out".to_string()))
}

/// 门户整屏截图，返回 PNG 文件路径（桌面环境决定保存位置，调用方负责清理）。
pub fn capture_full_screen() -> Result<PathBuf, String> {
    let (reply_tx, reply_rx) = mpsc::sync_channel(1);
    if runtime_tx()
        .send(PortalCmd::Screenshot { reply: reply_tx })
        .is_err()
    {
        return Err("[linux-portal] portal runtime exited".to_string());
    }
    reply_rx
        .recv_timeout(Duration::from_secs(60))
        .unwrap_or_else(|_| Err("[linux-portal] screenshot timed out".to_string()))
}

/// 屏幕捕获权限是否已授予（仅 Wayland 有意义）。
pub fn screenshot_permission_granted() -> bool {
    let (reply_tx, reply_rx) = mpsc::sync_channel(1);
    if runtime_tx()
        .send(PortalCmd::PermissionGranted { reply: reply_tx })
        .is_err()
    {
        return false;
    }
    reply_rx
        .recv_timeout(Duration::from_secs(5))
        .unwrap_or(false)
}

/// 请求屏幕捕获权限：优先触发系统授权弹窗（调用方窗口应处于聚焦状态），
/// 失败时回退为直接写入权限存储（等价于在系统弹窗里点了「允许」）。
pub fn request_screenshot_permission() -> Result<(), String> {
    let (reply_tx, reply_rx) = mpsc::sync_channel(1);
    if runtime_tx()
        .send(PortalCmd::RequestPermission { reply: reply_tx })
        .is_err()
    {
        return Err("[linux-portal] portal runtime exited".to_string());
    }
    reply_rx
        .recv_timeout(Duration::from_secs(90))
        .unwrap_or_else(|_| Err("[linux-portal] permission request timed out".to_string()))
}

// ---------------------------------------------------------------------------
// 全局热键会话
// ---------------------------------------------------------------------------

struct ShortcutSession {
    conn: Connection,
    stream: MessageStream,
    session_handle: OwnedObjectPath,
    actions: HashMap<String, LinuxHotkeyAction>,
}

async fn shortcut_session_task(
    app: AppHandle,
    entries: Vec<PortalShortcutEntry>,
    phase: mpsc::SyncSender<Result<(), String>>,
) {
    let session = match create_shortcut_session(&entries).await {
        Ok(session) => {
            let _ = phase.send(Ok(()));
            session
        }
        Err(err) => {
            eprintln!("[linux-portal] GlobalShortcuts session create failed: {err}");
            let _ = phase.send(Err(err));
            return;
        }
    };
    let mut session = session;
    if let Err(err) = bind_shortcuts(&mut session, &entries).await {
        eprintln!("[linux-portal] BindShortcuts failed: {err}");
        return;
    }
    run_shortcut_event_loop(&app, &mut session).await;
}

async fn create_shortcut_session(
    entries: &[PortalShortcutEntry],
) -> Result<ShortcutSession, String> {
    let conn = Connection::session()
        .await
        .map_err(|e| format!("D-Bus session bus unavailable: {e}"))?;
    // 先创建消息流再订阅匹配规则，避免遗漏信号
    let mut stream = MessageStream::from(&conn);
    let dbus_proxy = DBusProxy::new(&conn)
        .await
        .map_err(|e| format!("DBus proxy init failed: {e}"))?;
    let response_rule = MatchRule::builder()
        .msg_type(MsgType::Signal)
        .interface(REQUEST_IFACE)
        .map_err(|e| e.to_string())?
        .member("Response")
        .map_err(|e| e.to_string())?
        .build();
    dbus_proxy
        .add_match_rule(response_rule)
        .await
        .map_err(|e| format!("subscribe Request.Response failed: {e}"))?;
    let shortcuts_rule = MatchRule::builder()
        .msg_type(MsgType::Signal)
        .interface(GLOBAL_SHORTCUTS_IFACE)
        .map_err(|e| e.to_string())?
        .build();
    dbus_proxy
        .add_match_rule(shortcuts_rule)
        .await
        .map_err(|e| format!("subscribe GlobalShortcuts signals failed: {e}"))?;

    let token = format!("kivio_{}", uuid::Uuid::new_v4().simple());
    let mut options: HashMap<String, Value<'static>> = HashMap::new();
    options.insert("session_handle_token".to_string(), Value::new(token));
    let reply = conn
        .call_method(
            Some(PORTAL_DEST),
            PORTAL_PATH,
            Some(GLOBAL_SHORTCUTS_IFACE),
            "CreateSession",
            &options,
        )
        .await
        .map_err(|e| format!("GlobalShortcuts.CreateSession failed: {e}"))?;
    // 注意：CreateSession 的方法返回值只是 Request 对象路径；真正的会话句柄
    // session_handle 在该 Request 的 Response 信号 results 里。
    // xdg-desktop-portal 1.21 以字符串（签名 s）返回，而非对象路径。
    let request_path: OwnedObjectPath = reply
        .body()
        .deserialize()
        .map_err(|e| format!("CreateSession reply parse failed: {e}"))?;
    let (resp, results) =
        await_request_response(&mut stream, request_path.as_str(), Duration::from_secs(30)).await?;
    if resp != 0 {
        return Err(format!("CreateSession rejected by portal (resp={resp})"));
    }
    let session_handle_str = results
        .get("session_handle")
        .and_then(|value| <&str>::try_from(value).ok())
        .map(|value| value.to_string())
        .ok_or_else(|| "CreateSession response missing session_handle".to_string())?;
    let session_handle = OwnedObjectPath::try_from(session_handle_str)
        .map_err(|e| format!("CreateSession returned invalid session_handle: {e}"))?;

    let actions = entries
        .iter()
        .map(|entry| (entry.id.to_string(), entry.action))
        .collect();

    Ok(ShortcutSession {
        conn,
        stream,
        session_handle,
        actions,
    })
}

async fn bind_shortcuts(
    session: &mut ShortcutSession,
    entries: &[PortalShortcutEntry],
) -> Result<(), String> {
    let shortcuts: Vec<(String, HashMap<String, Value<'static>>)> = entries
        .iter()
        .map(|entry| {
            let mut options: HashMap<String, Value<'static>> = HashMap::new();
            // 注意：xdg-desktop-portal 1.21 核心会按白名单过滤快捷键条目选项，
            // 白名单里是 preferred_trigger（下划线）；连字符写法会被静默丢弃。
            options.insert(
                "preferred_trigger".to_string(),
                Value::new(entry.trigger.clone()),
            );
            options.insert(
                "description".to_string(),
                Value::new(entry.description.to_string()),
            );
            (entry.id.to_string(), options)
        })
        .collect();
    let bind_options: HashMap<String, Value<'static>> = HashMap::new();
    let body = (session.session_handle.clone(), shortcuts, "", bind_options);
    let reply = session
        .conn
        .call_method(
            Some(PORTAL_DEST),
            PORTAL_PATH,
            Some(GLOBAL_SHORTCUTS_IFACE),
            "BindShortcuts",
            &body,
        )
        .await
        .map_err(|e| format!("GlobalShortcuts.BindShortcuts failed: {e}"))?;
    let request_path: OwnedObjectPath = reply
        .body()
        .deserialize()
        .map_err(|e| format!("BindShortcuts reply parse failed: {e}"))?;
    // 首次绑定会弹出桌面环境的确认窗口，给用户充足时间操作
    let (resp, _results) = await_request_response(
        &mut session.stream,
        request_path.as_str(),
        Duration::from_secs(600),
    )
    .await?;
    if resp != 0 {
        return Err(format!("BindShortcuts rejected by portal (resp={resp})"));
    }
    Ok(())
}

async fn run_shortcut_event_loop(app: &AppHandle, session: &mut ShortcutSession) {
    while let Some(item) = session.stream.next().await {
        let msg = match item {
            Ok(msg) => msg,
            Err(err) => {
                eprintln!("[linux-portal] shortcut message stream error: {err}");
                continue;
            }
        };
        if msg.message_type() != MsgType::Signal {
            continue;
        }
        let header = msg.header();
        let interface = header.interface().map(|name| name.as_str().to_string());
        let member = header.member().map(|name| name.as_str().to_string());
        match (interface.as_deref(), member.as_deref()) {
            (Some(GLOBAL_SHORTCUTS_IFACE), Some("Activated")) => {
                let parsed: Result<(OwnedObjectPath, String, u64, HashMap<String, OwnedValue>), _> =
                    msg.body().deserialize();
                if let Ok((_session_handle, shortcut_id, _timestamp, _options)) = parsed {
                    if let Some(action) = session.actions.get(&shortcut_id) {
                        crate::shortcuts::dispatch_linux_hotkey(app, *action);
                    } else {
                        eprintln!(
                            "[linux-portal] Activated for unknown shortcut id: {shortcut_id}"
                        );
                    }
                }
            }
            (Some(SESSION_IFACE), Some("SessionClosed")) => {
                eprintln!("[linux-portal] GlobalShortcuts session closed by portal");
                return;
            }
            _ => {}
        }
    }
}

/// 等待指定 Request 对象路径上的 Response 信号，返回 (response 码, results)。
async fn await_request_response(
    stream: &mut MessageStream,
    request_path: &str,
    timeout: Duration,
) -> Result<(u32, HashMap<String, OwnedValue>), String> {
    let deadline = tokio::time::Instant::now() + timeout;
    loop {
        let now = tokio::time::Instant::now();
        if now >= deadline {
            return Err("waiting for portal Response timed out".to_string());
        }
        let item = match tokio::time::timeout(deadline - now, stream.next()).await {
            Ok(item) => item,
            Err(_) => return Err("waiting for portal Response timed out".to_string()),
        };
        let msg = match item {
            Some(Ok(msg)) => msg,
            Some(Err(err)) => return Err(format!("portal message stream error: {err}")),
            None => return Err("portal message stream closed".to_string()),
        };
        if msg.message_type() != MsgType::Signal {
            continue;
        }
        let header = msg.header();
        let is_response = header.interface().map(|name| name.as_str()) == Some(REQUEST_IFACE)
            && header.member().map(|name| name.as_str()) == Some("Response");
        if !is_response {
            continue;
        }
        if header.path().map(|path| path.as_str()) != Some(request_path) {
            continue;
        }
        let body: (u32, HashMap<String, OwnedValue>) = msg
            .body()
            .deserialize()
            .map_err(|e| format!("portal Response body parse failed: {e}"))?;
        return Ok(body);
    }
}

// ---------------------------------------------------------------------------
// 屏幕截图 / 权限
// ---------------------------------------------------------------------------

async fn portal_screenshot_inner() -> Result<PathBuf, String> {
    let conn = Connection::session()
        .await
        .map_err(|e| format!("D-Bus session bus unavailable: {e}"))?;
    let mut stream = MessageStream::from(&conn);
    let dbus_proxy = DBusProxy::new(&conn)
        .await
        .map_err(|e| format!("DBus proxy init failed: {e}"))?;
    let rule = MatchRule::builder()
        .msg_type(MsgType::Signal)
        .interface(REQUEST_IFACE)
        .map_err(|e| e.to_string())?
        .member("Response")
        .map_err(|e| e.to_string())?
        .build();
    dbus_proxy
        .add_match_rule(rule)
        .await
        .map_err(|e| format!("subscribe Request.Response failed: {e}"))?;

    let mut options: HashMap<String, Value<'static>> = HashMap::new();
    options.insert("interactive".to_string(), Value::new(false));
    options.insert("modal".to_string(), Value::new(false));
    let reply = tokio::time::timeout(
        Duration::from_secs(10),
        conn.call_method(
            Some(PORTAL_DEST),
            PORTAL_PATH,
            Some(SCREENSHOT_IFACE),
            "Screenshot",
            &("", options),
        ),
    )
    .await
    .map_err(|_| "Screenshot portal call timed out".to_string())?
    .map_err(|e| format!("Screenshot portal call failed: {e}"))?;
    let request_path: OwnedObjectPath = reply
        .body()
        .deserialize()
        .map_err(|e| format!("Screenshot reply parse failed: {e}"))?;
    let (resp, results) =
        await_request_response(&mut stream, request_path.as_str(), Duration::from_secs(30)).await?;
    if resp != 0 {
        if !permission_granted_inner().await {
            return Err(
                "屏幕捕获权限未授予。请在「设置 → 通用 → 权限状态」中点击「授权屏幕捕获」后重试。"
                    .to_string(),
            );
        }
        return Err(format!("portal screenshot was cancelled (resp={resp})"));
    }
    let uri = results
        .get("uri")
        .and_then(|value| <&str>::try_from(value).ok())
        .map(|value| value.to_string())
        .ok_or_else(|| "portal screenshot response missing uri".to_string())?;
    file_uri_to_path(&uri)
}

fn file_uri_to_path(uri: &str) -> Result<PathBuf, String> {
    let rest = uri
        .strip_prefix("file://")
        .ok_or_else(|| format!("screenshot uri is not a file:// path: {uri}"))?;
    let decoded = percent_encoding::percent_decode_str(rest)
        .decode_utf8()
        .map_err(|e| format!("invalid uri encoding: {e}"))?;
    Ok(PathBuf::from(decoded.into_owned()))
}

async fn permission_lookup(conn: &Connection) -> Result<HashMap<String, Vec<String>>, String> {
    let reply = conn
        .call_method(
            Some(PERMISSION_DEST),
            PERMISSION_PATH,
            Some(PERMISSION_DEST),
            "Lookup",
            &(SCREENSHOT_TABLE, SCREENSHOT_PERM_ID),
        )
        .await
        .map_err(|e| format!("PermissionStore.Lookup failed: {e}"))?;
    let (permissions, _data): (HashMap<String, Vec<String>>, OwnedValue) = reply
        .body()
        .deserialize()
        .map_err(|e| format!("PermissionStore.Lookup reply parse failed: {e}"))?;
    Ok(permissions)
}

async fn permission_granted_inner() -> bool {
    let Ok(conn) = Connection::session().await else {
        return false;
    };
    let Ok(permissions) = permission_lookup(&conn).await else {
        return false;
    };
    let candidates = app_id_candidates();
    permissions.iter().any(|(app_id, values)| {
        (app_id.is_empty() || candidates.iter().any(|candidate| candidate == app_id))
            && values.iter().any(|value| value == "yes")
    })
}

async fn request_permission_inner() -> Result<(), String> {
    // 1) 触发一次门户截图：若窗口聚焦且权限未定，桌面环境会弹出授权窗口
    match portal_screenshot_inner().await {
        Ok(path) => {
            let _ = std::fs::remove_file(&path);
            return Ok(());
        }
        Err(err) => {
            eprintln!("[linux-portal] interactive permission grant failed: {err}");
        }
    }
    // 2) 回退：直接写入权限存储（等价于用户在系统弹窗中点击「允许」）。
    //    对 KDE 等不读取该存储的实现可能无效，此时提示用户聚焦窗口重试。
    let conn = Connection::session()
        .await
        .map_err(|e| format!("D-Bus session bus unavailable: {e}"))?;
    for app_id in app_id_candidates() {
        let body = (
            SCREENSHOT_TABLE,
            true,
            SCREENSHOT_PERM_ID,
            app_id.as_str(),
            vec!["yes".to_string()],
        );
        if let Err(err) = conn
            .call_method(
                Some(PERMISSION_DEST),
                PERMISSION_PATH,
                Some(PERMISSION_DEST),
                "SetPermission",
                &body,
            )
            .await
        {
            eprintln!("[linux-portal] SetPermission failed for {app_id}: {err}");
        }
    }
    if permission_granted_inner().await {
        Ok(())
    } else {
        Err("无法自动获得屏幕捕获权限，请确保 Kivio 窗口处于聚焦状态后重试。".to_string())
    }
}
