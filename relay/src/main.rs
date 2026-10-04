
use std::collections::HashMap;
use std::io::{BufRead, Read, Write};
use std::net::{SocketAddr, TcpStream};
use std::sync::{mpsc, Arc, Mutex};
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
    "COPILOT_SESSION_ID",
    "QWEN_CODE",
    "KIRO_SESSION_ID",
];

fn main() {
    if std::env::args().any(|a| a == "--mcp") {
        mcp();
    }
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
        || event == "permissionRequest"
        || (agent == "antigravity" && event == "PreToolUse")
        || (agent == "windsurf" && matches!(event.as_str(), "pre_run_command" | "pre_write_code" | "pre_mcp_tool_use"))
        || (agent == "kiro" && (event == "PreToolUse" || event == "preToolUse"))
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
    if out.starts_with('{') && out.contains("__kumo_exit") {
        if let Ok(v) = serde_json::from_str::<Value>(out) {
            let code = v.get("__kumo_exit").and_then(Value::as_i64).unwrap_or(0) as i32;
            if let Some(text) = v.get("stdout").and_then(Value::as_str).filter(|t| !t.is_empty()) {
                let mut stdout = std::io::stdout();
                let _ = writeln!(stdout, "{text}");
                let _ = stdout.flush();
            }
            if let Some(text) = v.get("stderr").and_then(Value::as_str).filter(|t| !t.is_empty()) {
                let mut stderr = std::io::stderr();
                let _ = writeln!(stderr, "{text}");
                let _ = stderr.flush();
            }
            std::process::exit(code);
        }
    }
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
    if agent == "copilot-cli" || agent == "github-copilot" {
        agent = "copilot".into();
    }
    if agent == "qwen-code" {
        agent = "qwen".into();
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
    post_to("/v1/hook", port, token, body, budget)
}

fn post_to(path: &str, port: u16, token: &str, body: &str, budget: Duration) -> Option<String> {
    let addr = SocketAddr::from(([127, 0, 0, 1], port));
    let mut stream = TcpStream::connect_timeout(&addr, CONNECT_TIMEOUT).ok()?;
    let _ = stream.set_nodelay(true);
    stream.set_write_timeout(Some(Duration::from_secs(3))).ok()?;
    stream.set_read_timeout(Some(budget)).ok()?;
    let req = format!(
        "POST {path} HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nX-Kumo-Token: {token}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
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


fn mcp_tools() -> Value {
    serde_json::json!([
        {
            "name": "ask_user",
            "description": "Ask the person at the computer a question through Kumo, a small window at the top of their screen, and wait for the answer. Use it when you need a decision, a choice between approaches or a confirmation and the person may not be watching this conversation. Offer up to four short options when you can. Returns the answer as text.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "question": { "type": "string", "description": "The question, in one or two short sentences." },
                    "options": { "type": "array", "items": { "type": "string" }, "maxItems": 4, "description": "Short answers that can be picked with one click." },
                    "allow_text": { "type": "boolean", "description": "Allow a typed answer as well. Defaults to true." }
                },
                "required": ["question"]
            }
        },
        {
            "name": "notify_user",
            "description": "Show a short notification in Kumo at the top of the screen, for example when a long task is finished or you are blocked and need attention. Does not wait for a reply.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "message": { "type": "string", "description": "What happened, in one sentence." },
                    "title": { "type": "string", "description": "Optional short title." }
                },
                "required": ["message"]
            }
        }
    ])
}

fn mcp() -> ! {
    let out = Arc::new(Mutex::new(std::io::stdout()));
    let send = |out: &Arc<Mutex<std::io::Stdout>>, v: Value| {
        if let Ok(mut o) = out.lock() {
            let _ = writeln!(o, "{v}");
            let _ = o.flush();
        }
    };
    let (ancestors, _) = ancestry();
    let cwd = std::env::current_dir().map(|p| p.to_string_lossy().to_string()).unwrap_or_default();
    let mut env = Map::new();
    for k in ENV_KEYS {
        if let Ok(v) = std::env::var(k) {
            env.insert((*k).into(), Value::String(v.chars().take(300).collect()));
        }
    }
    let agent = std::env::args().skip_while(|a| a != "--agent").nth(1).unwrap_or_default();
    let context = Arc::new(serde_json::json!({ "ancestors": ancestors, "cwd": cwd, "env": env, "agent": agent }));
    let mut calls = Vec::new();
    let stdin = std::io::stdin();
    for line in stdin.lock().lines() {
        let Ok(line) = line else { break };
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        let Ok(msg) = serde_json::from_str::<Value>(line) else { continue };
        let method = msg.get("method").and_then(Value::as_str).unwrap_or("").to_string();
        let Some(id) = msg.get("id").cloned() else { continue };
        match method.as_str() {
            "initialize" => {
                let version = msg.pointer("/params/protocolVersion").and_then(Value::as_str).unwrap_or("2025-06-18").to_string();
                send(&out, serde_json::json!({
                    "jsonrpc": "2.0",
                    "id": id,
                    "result": {
                        "protocolVersion": version,
                        "capabilities": { "tools": { "listChanged": false } },
                        "serverInfo": { "name": "kumo", "version": env!("CARGO_PKG_VERSION") },
                        "instructions": "Kumo shows your questions and notifications at the top of the screen. Use ask_user when you need a decision and notify_user when something needs attention."
                    }
                }));
            }
            "ping" => send(&out, serde_json::json!({ "jsonrpc": "2.0", "id": id, "result": {} })),
            "tools/list" => send(&out, serde_json::json!({ "jsonrpc": "2.0", "id": id, "result": { "tools": mcp_tools() } })),
            "tools/call" => {
                let out = Arc::clone(&out);
                let context = Arc::clone(&context);
                let params = msg.get("params").cloned().unwrap_or(Value::Null);
                calls.push(std::thread::spawn(move || {
                    let tool = params.get("name").and_then(Value::as_str).unwrap_or("").to_string();
                    let args = params.get("arguments").cloned().unwrap_or(Value::Object(Map::new()));
                    let budget = if tool == "ask_user" { DECISION_BUDGET } else { QUICK_BUDGET };
                    let body = serde_json::json!({ "tool": tool, "arguments": args, "context": *context }).to_string();
                    let reply = runtime().and_then(|(port, token)| post_to("/v1/mcp", port, &token, &body, budget));
                    let (text, error) = match reply.and_then(|r| serde_json::from_str::<Value>(r.trim()).ok()) {
                        Some(v) => (
                            v.get("text").and_then(Value::as_str).unwrap_or("").to_string(),
                            v.get("isError").and_then(Value::as_bool).unwrap_or(false),
                        ),
                        None => ("Kumo is not running right now. Ask in this conversation instead.".to_string(), true),
                    };
                    let result = serde_json::json!({ "content": [{ "type": "text", "text": text }], "isError": error });
                    if let Ok(mut o) = out.lock() {
                        let _ = writeln!(o, "{}", serde_json::json!({ "jsonrpc": "2.0", "id": id, "result": result }));
                        let _ = o.flush();
                    }
                }));
            }
            _ => send(&out, serde_json::json!({ "jsonrpc": "2.0", "id": id, "error": { "code": -32601, "message": "Method not found" } })),
        }
    }
    for call in calls {
        let _ = call.join();
    }
    std::process::exit(0)
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
