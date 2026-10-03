
use std::collections::HashMap;
use std::io::{Read, Write};
use std::net::{SocketAddr, TcpStream};
use std::sync::mpsc;
use std::time::Duration;

use serde_json::{Map, Value};

const CONNECT_TIMEOUT: Duration = Duration::from_millis(300);
const QUICK_BUDGET: Duration = Duration::from_secs(4);
const DECISION_BUDGET: Duration = Duration::from_secs(610);
const MAX_FIELD: usize = 4000;
const DROPPED: &[&str] = &["tool_response", "tool_output", "transcript"];
const ENV_KEYS: &[&str] = &[
    "TERM_PROGRAM",
    "TERM_SESSION_ID",
    "ITERM_SESSION_ID",
    "WT_SESSION",
    "VSCODE_GIT_IPC_HANDLE",
    "__CFBundleIdentifier",
    "CLAUDE_CODE_ENTRYPOINT",
    "CLAUDE_PID",
    "ANTIGRAVITY_CLI",
    "GEMINI_CLI",
    "GEMINI_SESSION_ID",
    "CODEX_SANDBOX",
    "CURSOR_TRACE_ID",
];

fn main() {
    let tee = std::env::args().any(|a| a == "--tee");
    if std::env::var_os("KUMO_INTERNAL").is_some() && !tee {
        std::process::exit(0);
    }
    let (agent, arg_event) = parse_args();

    let mut neutral = if matches!(agent.as_str(), "antigravity" | "gemini" | "cursor") { "{}" } else { "" };
    if agent == "antigravity" && (arg_event == "PreToolUse" || arg_event.is_empty()) {
        neutral = r#"{"decision":"ask"}"#;
    }

    let mut raw = Vec::new();
    let _ = std::io::stdin().read_to_end(&mut raw);
    if tee {

        let mut stdout = std::io::stdout();
        let _ = stdout.write_all(&raw);
        let _ = stdout.flush();
        drop(stdout);
        if std::env::var_os("KUMO_INTERNAL").is_some() {
            std::process::exit(0);
        }
    }
    if raw.starts_with(&[0xEF, 0xBB, 0xBF]) {
        raw.drain(..3);
    }
    let mut payload = serde_json::from_slice::<Value>(&raw).unwrap_or(Value::Object(Map::new()));
    if !payload.is_object() {
        payload = Value::Object(Map::new());
    }
    let event = payload
        .get("hook_event_name")
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| arg_event.clone());
    if event.is_empty() {
        finish(neutral);
    }
    if let Some(map) = payload.as_object_mut() {
        for k in DROPPED {
            map.remove(*k);
        }
    }
    truncate(&mut payload);

    let waits = event == "PermissionRequest"
        || (agent == "antigravity" && event == "PreToolUse")
        || (agent == "gemini" && event == "BeforeTool")
        || (agent == "cursor" && (event == "beforeShellExecution" || event == "beforeMCPExecution"));
    let budget = if waits { DECISION_BUDGET } else if tee { Duration::from_millis(800) } else { QUICK_BUDGET };

    let (ancestors, tty) = ancestry();
    let mut env = Map::new();
    for k in ENV_KEYS {
        if let Ok(v) = std::env::var(k) {
            env.insert((*k).into(), Value::String(v.chars().take(300).collect()));
        }
    }
    if let Some(t) = tty {
        env.insert("TTY".into(), Value::String(t));
    }
    let cwd = std::env::current_dir().map(|p| p.to_string_lossy().to_string()).unwrap_or_default();

    let body = serde_json::json!({
        "agent": agent,
        "event": event,
        "payload": payload,
        "env": env,
        "ancestors": ancestors,
        "cwd": cwd,
    })
    .to_string();

    let Some((port, token)) = runtime() else { finish(neutral) };

    let (tx, rx) = mpsc::channel::<Option<String>>();
    std::thread::spawn(move || {
        let _ = tx.send(post(port, &token, &body, budget));
    });
    let answer = rx.recv_timeout(budget + Duration::from_millis(200));
    if tee {
        std::process::exit(0);
    }
    match answer {
        Ok(Some(answer)) if !answer.trim().is_empty() => finish(answer.trim()),
        _ => finish(neutral),
    }
}

fn finish(out: &str) -> ! {
    if !out.is_empty() {
        let mut stdout = std::io::stdout();
        let _ = writeln!(stdout, "{out}");
        let _ = stdout.flush();
    }
    std::process::exit(0)
}

fn parse_args() -> (String, String) {
    let mut agent = String::from("claude-code");
    let mut event = String::new();
    let mut it = std::env::args().skip(1);
    while let Some(a) = it.next() {
        if a == "--agent" {
            agent = it.next().unwrap_or_default().to_lowercase();
        } else if a.starts_with("--") {
            continue;
        } else if event.is_empty() {
            event = a;
        }
    }
    if agent == "claude" {
        agent = "claude-code".into();
    }
    if agent == "agy" {
        agent = "antigravity".into();
    }
    if agent == "gemini-cli" {
        agent = "gemini".into();
    }
    (agent, event)
}

fn truncate(v: &mut Value) {
    match v {
        Value::String(s) if s.len() > MAX_FIELD => {
            let mut end = MAX_FIELD;
            while end > 0 && !s.is_char_boundary(end) {
                end -= 1;
            }
            s.truncate(end);
            s.push('…');
        }
        Value::Array(items) => items.iter_mut().for_each(truncate),
        Value::Object(map) => map.values_mut().for_each(truncate),
        _ => {}
    }
}

fn home() -> Option<std::path::PathBuf> {
    let var = if cfg!(windows) { "USERPROFILE" } else { "HOME" };
    std::env::var_os(var).map(std::path::PathBuf::from)
}

fn runtime() -> Option<(u16, String)> {
    let path = home()?.join(".kumo").join("runtime.json");
    let text = std::fs::read_to_string(path).ok()?;
    let v: Value = serde_json::from_str(text.trim_start_matches('\u{feff}')).ok()?;
    let port = v.get("port")?.as_u64()? as u16;
    let token = v.get("token")?.as_str()?.to_string();
    (port > 0 && !token.is_empty()).then_some((port, token))
}

fn post(port: u16, token: &str, body: &str, budget: Duration) -> Option<String> {
    let addr = SocketAddr::from(([127, 0, 0, 1], port));
    let mut stream = TcpStream::connect_timeout(&addr, CONNECT_TIMEOUT).ok()?;
    let _ = stream.set_nodelay(true);
    stream.set_write_timeout(Some(Duration::from_secs(3))).ok()?;
    stream.set_read_timeout(Some(budget)).ok()?;
    let req = format!(
        "POST /v1/hook HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nX-Kumo-Token: {token}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
        body.len()
    );
    stream.write_all(req.as_bytes()).ok()?;
    stream.write_all(body.as_bytes()).ok()?;
    stream.flush().ok()?;
    let mut buf = Vec::new();
    stream.read_to_end(&mut buf).ok()?;
    let text = String::from_utf8_lossy(&buf);
    let (head, rest) = text.split_once("\r\n\r\n")?;
    if !head.starts_with("HTTP/1.1 200") && !head.starts_with("HTTP/1.0 200") {
        return None;
    }
    Some(rest.to_string())
}


#[cfg(windows)]
fn ancestry() -> (Vec<Value>, Option<String>) {
    use windows_sys::Win32::Foundation::{CloseHandle, INVALID_HANDLE_VALUE};
    use windows_sys::Win32::System::Diagnostics::ToolHelp::{CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W, TH32CS_SNAPPROCESS};
    use windows_sys::Win32::System::Threading::GetCurrentProcessId;

    let mut table: HashMap<u32, (u32, String)> = HashMap::new();
    unsafe {
        let snap = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
        if snap == INVALID_HANDLE_VALUE {
            return (Vec::new(), None);
        }
        let mut entry: PROCESSENTRY32W = std::mem::zeroed();
        entry.dwSize = std::mem::size_of::<PROCESSENTRY32W>() as u32;
        if Process32FirstW(snap, &mut entry) != 0 {
            loop {
                let len = entry.szExeFile.iter().position(|&c| c == 0).unwrap_or(entry.szExeFile.len());
                let name = String::from_utf16_lossy(&entry.szExeFile[..len]);
                table.insert(entry.th32ProcessID, (entry.th32ParentProcessID, name));
                if Process32NextW(snap, &mut entry) == 0 {
                    break;
                }
            }
        }
        CloseHandle(snap);
        walk(&table, GetCurrentProcessId())
    }
}

#[cfg(windows)]
fn walk(table: &HashMap<u32, (u32, String)>, start: u32) -> (Vec<Value>, Option<String>) {
    let mut out = Vec::new();
    let mut pid = table.get(&start).map(|e| e.0).unwrap_or(0);
    let mut seen = std::collections::HashSet::new();
    while pid != 0 && out.len() < 14 && seen.insert(pid) {
        let Some((parent, name)) = table.get(&pid) else { break };
        out.push(serde_json::json!({ "pid": pid, "name": name }));
        pid = *parent;
    }
    (out, None)
}

#[cfg(not(windows))]
fn ancestry() -> (Vec<Value>, Option<String>) {
    let Ok(out) = std::process::Command::new("ps").args(["-A", "-o", "pid=,ppid=,tty=,comm="]).output() else {
        return (Vec::new(), None);
    };
    let text = String::from_utf8_lossy(&out.stdout);
    let mut table: HashMap<u32, (u32, String, String)> = HashMap::new();
    for line in text.lines() {
        let mut parts = line.split_whitespace();
        let (Some(pid), Some(ppid), Some(tty)) = (parts.next(), parts.next(), parts.next()) else { continue };
        let comm: Vec<&str> = parts.collect();
        let name = comm.join(" ");
        let short = name.rsplit('/').next().unwrap_or(&name).to_string();
        if let (Ok(p), Ok(pp)) = (pid.parse(), ppid.parse()) {
            table.insert(p, (pp, tty.to_string(), short));
        }
    }
    let mut res = Vec::new();
    let mut tty = None;
    let mut pid = std::os::unix::process::parent_id();
    let mut seen = std::collections::HashSet::new();
    while pid > 1 && res.len() < 14 && seen.insert(pid) {
        let Some((parent, t, name)) = table.get(&pid) else { break };
        if tty.is_none() && t != "??" && t != "?" && !t.is_empty() {
            tty = Some(if t.starts_with("/dev/") { t.clone() } else { format!("/dev/{t}") });
        }
        res.push(serde_json::json!({ "pid": pid, "name": name }));
        pid = *parent;
    }
    (res, tty)
}
