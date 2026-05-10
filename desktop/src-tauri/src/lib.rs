use reqwest::header::{HeaderMap, HeaderName, HeaderValue};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::fs;
use std::path::PathBuf;
use std::process::Command;
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{Manager, State};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
enum TaskStatus {
    Pending,
    Running,
    Success,
    Failed,
    Canceled,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
enum TaskType {
    Download,
    Combine,
    Cut,
}

impl TaskType {
    fn from_str(value: &str) -> Result<Self, String> {
        match value {
            "download" => Ok(Self::Download),
            "combine" => Ok(Self::Combine),
            "cut" => Ok(Self::Cut),
            _ => Err(format!("不支持的任务类型: {}", value)),
        }
    }

    fn as_str(&self) -> &'static str {
        match self {
            Self::Download => "download",
            Self::Combine => "combine",
            Self::Cut => "cut",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct TaskRecord {
    id: u64,
    task_type: TaskType,
    params: Value,
    status: TaskStatus,
    retry_count: u32,
    command_display: String,
    logs: String,
    error: Option<String>,
    result_path: Option<String>,
    created_at: u64,
    updated_at: u64,
}

#[derive(Debug, Clone, Deserialize)]
struct CreateTaskInput {
    task_type: String,
    params: Value,
}

#[derive(Debug, Clone, Deserialize)]
struct HeaderInput {
    key: String,
    value: String,
}

#[derive(Debug, Clone, Deserialize)]
struct PlaylistRequest {
    url: String,
    #[serde(default)]
    headers: Vec<HeaderInput>,
}

#[derive(Debug, Clone, Serialize)]
struct ChannelInfo {
    name: String,
    group: String,
    url: String,
}

#[derive(Debug, Clone, Serialize)]
struct M3u8VariantInfo {
    name: String,
    bandwidth: Option<u64>,
    resolution: Option<String>,
    url: String,
}

#[derive(Debug, Clone, Serialize)]
struct M3u8ManifestInfo {
    is_master: bool,
    variants: Vec<M3u8VariantInfo>,
}

#[derive(Debug, Clone, Serialize)]
struct PlaylistParseResponse {
    kind: String,
    channels: Vec<ChannelInfo>,
    m3u8: Option<M3u8ManifestInfo>,
}

#[derive(Debug, Clone)]
struct CommandSpec {
    program: String,
    args: Vec<String>,
    display: String,
    result_path: Option<String>,
}

#[derive(Debug)]
struct AppStateInner {
    tasks: Mutex<Vec<TaskRecord>>,
    storage_path: PathBuf,
    repo_root: PathBuf,
    cli_binary: Option<PathBuf>,
}

#[derive(Clone, Debug)]
struct AppState {
    inner: Arc<AppStateInner>,
}

fn now_ts() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

fn next_task_id(tasks: &[TaskRecord]) -> u64 {
    tasks.iter().map(|t| t.id).max().unwrap_or(0) + 1
}

fn load_tasks(storage_path: &PathBuf) -> Vec<TaskRecord> {
    match fs::read_to_string(storage_path) {
        Ok(content) => serde_json::from_str::<Vec<TaskRecord>>(&content).unwrap_or_default(),
        Err(_) => Vec::new(),
    }
}

fn save_tasks(storage_path: &PathBuf, tasks: &[TaskRecord]) -> Result<(), String> {
    let content = serde_json::to_string_pretty(tasks).map_err(|e| format!("序列化任务失败: {}", e))?;
    fs::write(storage_path, content).map_err(|e| format!("写入任务文件失败: {}", e))
}

fn get_string(params: &Value, key: &str) -> Option<String> {
    params
        .get(key)
        .and_then(|v| v.as_str())
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty())
}

fn get_u32(params: &Value, key: &str) -> Option<u32> {
    params
        .get(key)
        .and_then(|v| v.as_u64())
        .and_then(|v| u32::try_from(v).ok())
}

fn get_i32(params: &Value, key: &str) -> Option<i32> {
    params
        .get(key)
        .and_then(|v| v.as_i64())
        .and_then(|v| i32::try_from(v).ok())
}

fn get_bool(params: &Value, key: &str) -> bool {
    params.get(key).and_then(|v| v.as_bool()).unwrap_or(false)
}

fn resolve_cli_execution(inner: &AppStateInner, cli_args: &[String]) -> CommandSpec {
    if let Some(cli_binary) = &inner.cli_binary {
        if cli_binary.exists() {
            let display = format!(
                "{} {}",
                cli_binary.display(),
                cli_args.join(" ")
            );
            return CommandSpec {
                program: cli_binary.to_string_lossy().to_string(),
                args: cli_args.to_vec(),
                display,
                result_path: None,
            };
        }
    }

    let local_binary = inner.repo_root.join("target/debug/media-tool-rs");
    if local_binary.exists() {
        let display = format!("{} {}", local_binary.display(), cli_args.join(" "));
        return CommandSpec {
            program: local_binary.to_string_lossy().to_string(),
            args: cli_args.to_vec(),
            display,
            result_path: None,
        };
    }

    let mut cargo_args = vec![
        "run".to_string(),
        "--manifest-path".to_string(),
        inner
            .repo_root
            .join("Cargo.toml")
            .to_string_lossy()
            .to_string(),
        "--".to_string(),
    ];
    cargo_args.extend(cli_args.to_vec());
    CommandSpec {
        program: "cargo".to_string(),
        args: cargo_args.clone(),
        display: format!("cargo {}", cargo_args.join(" ")),
        result_path: None,
    }
}

fn build_command(task_type: &TaskType, params: &Value, inner: &AppStateInner) -> Result<CommandSpec, String> {
    let mut cli_args = Vec::new();
    let mut result_path: Option<String> = None;

    match task_type {
        TaskType::Download => {
            let url = get_string(params, "url").ok_or_else(|| "download 缺少 url 参数".to_string())?;
            cli_args.push("download".to_string());
            cli_args.push(format!("--url={}", url));
            if let Some(folder) = get_string(params, "folder") {
                cli_args.push(format!("--folder={}", folder));
            }
            if let Some(target_file_name) = get_string(params, "target_file_name") {
                result_path = Some(target_file_name.clone());
                cli_args.push(format!("--target_file_name={}", target_file_name));
            }
            if let Some(concurrent) = get_i32(params, "concurrent") {
                if concurrent > 0 {
                    cli_args.push(format!("--concurrent={}", concurrent));
                }
            }
            if get_bool(params, "ffmpeg_download") {
                cli_args.push("--ffmpeg_download".to_string());
            }
        }
        TaskType::Combine => {
            let reg_name = get_string(params, "reg_name").ok_or_else(|| "combine 缺少 reg_name 参数".to_string())?;
            let reg_start = get_i32(params, "reg_file_start").ok_or_else(|| "combine 缺少 reg_file_start 参数".to_string())?;
            let reg_end = get_i32(params, "reg_file_end").ok_or_else(|| "combine 缺少 reg_file_end 参数".to_string())?;

            cli_args.push("combine".to_string());
            cli_args.push("-r".to_string());
            cli_args.push(reg_name);
            cli_args.push(format!("--reg-file-start={}", reg_start));
            cli_args.push(format!("--reg-file-end={}", reg_end));

            if let Some(target_file_name) = get_string(params, "target_file_name") {
                result_path = Some(target_file_name.clone());
                cli_args.push(format!("--target_file_name={}", target_file_name));
            }

            if let Some(same_param_index) = get_i32(params, "same_param_index") {
                cli_args.push(format!("--same_param_index={}", same_param_index));
            }
            if let Some(set_fps) = get_i32(params, "set_fps") {
                if set_fps > 0 {
                    cli_args.push(format!("--set_fps={}", set_fps));
                }
            }
            if let Some(set_a_b) = get_i32(params, "set_a_b") {
                if set_a_b > 0 {
                    cli_args.push(format!("--set_a_b={}", set_a_b));
                }
            }
            if let Some(set_v_b) = get_i32(params, "set_v_b") {
                if set_v_b > 0 {
                    cli_args.push(format!("--set_v_b={}", set_v_b));
                }
            }
            if let Some(set_width) = get_i32(params, "set_width") {
                if set_width > 0 {
                    cli_args.push(format!("--set_width={}", set_width));
                }
            }
            if let Some(set_height) = get_i32(params, "set_height") {
                if set_height > 0 {
                    cli_args.push(format!("--set_height={}", set_height));
                }
            }
        }
        TaskType::Cut => {
            let input = get_string(params, "input").ok_or_else(|| "cut 缺少 input 参数".to_string())?;
            let start = get_u32(params, "start").unwrap_or(0);
            let duration = get_u32(params, "duration").unwrap_or(3);

            cli_args.push("cut".to_string());
            cli_args.push(format!("-i={}", input));
            cli_args.push(format!("-s={}", start));
            cli_args.push(format!("-d={}", duration));

            if let Some(target_file_name) = get_string(params, "target_file_name") {
                result_path = Some(target_file_name.clone());
                cli_args.push(format!("--target_file_name={}", target_file_name));
            }
        }
    }

    let mut spec = resolve_cli_execution(inner, &cli_args);
    spec.result_path = result_path;
    Ok(spec)
}

fn update_task(inner: &Arc<AppStateInner>, task_id: u64, updater: impl FnOnce(&mut TaskRecord)) -> Result<(), String> {
    let mut tasks = inner.tasks.lock().map_err(|_| "任务锁获取失败".to_string())?;
    let task = tasks
        .iter_mut()
        .find(|task| task.id == task_id)
        .ok_or_else(|| format!("任务 {} 不存在", task_id))?;
    updater(task);
    save_tasks(&inner.storage_path, &tasks)
}

fn execute_task(inner: Arc<AppStateInner>, task_id: u64) {
    let task_snapshot = {
        let tasks = match inner.tasks.lock() {
            Ok(tasks) => tasks,
            Err(_) => return,
        };
        match tasks.iter().find(|task| task.id == task_id) {
            Some(task) => task.clone(),
            None => return,
        }
    };

    let command_spec = match build_command(&task_snapshot.task_type, &task_snapshot.params, &inner) {
        Ok(spec) => spec,
        Err(error_message) => {
            let _ = update_task(&inner, task_id, |task| {
                task.status = TaskStatus::Failed;
                task.error = Some(error_message.clone());
                task.updated_at = now_ts();
            });
            return;
        }
    };

    let _ = update_task(&inner, task_id, |task| {
        task.status = TaskStatus::Running;
        task.command_display = command_spec.display.clone();
        task.logs.clear();
        task.error = None;
        task.updated_at = now_ts();
    });

    let output = Command::new(&command_spec.program)
        .args(&command_spec.args)
        .output();

    match output {
        Ok(output) => {
            let mut logs = String::new();
            let stdout = String::from_utf8_lossy(&output.stdout);
            let stderr = String::from_utf8_lossy(&output.stderr);
            if !stdout.trim().is_empty() {
                logs.push_str("[stdout]\n");
                logs.push_str(stdout.as_ref());
                logs.push('\n');
            }
            if !stderr.trim().is_empty() {
                logs.push_str("[stderr]\n");
                logs.push_str(stderr.as_ref());
                logs.push('\n');
            }

            let success = output.status.success();
            let _ = update_task(&inner, task_id, |task| {
                task.logs = logs;
                task.status = if success {
                    TaskStatus::Success
                } else {
                    TaskStatus::Failed
                };
                task.error = if success {
                    None
                } else {
                    Some(format!("CLI 执行失败，退出码: {:?}", output.status.code()))
                };
                if success {
                    task.result_path = command_spec.result_path.clone();
                }
                task.updated_at = now_ts();
            });
        }
        Err(error) => {
            let _ = update_task(&inner, task_id, |task| {
                task.status = TaskStatus::Failed;
                task.error = Some(format!("启动命令失败: {}", error));
                task.updated_at = now_ts();
            });
        }
    }
}

fn spawn_task(inner: Arc<AppStateInner>, task_id: u64) {
    tauri::async_runtime::spawn_blocking(move || execute_task(inner, task_id));
}

#[tauri::command]
fn get_task_types() -> Vec<String> {
    vec!["download".to_string(), "combine".to_string(), "cut".to_string()]
}

#[tauri::command]
fn create_task(state: State<'_, AppState>, input: CreateTaskInput) -> Result<TaskRecord, String> {
    let task_type = TaskType::from_str(&input.task_type)?;

    {
        build_command(&task_type, &input.params, &state.inner)?;
    }

    let now = now_ts();
    let task = {
        let mut tasks = state
            .inner
            .tasks
            .lock()
            .map_err(|_| "任务锁获取失败".to_string())?;

        let task = TaskRecord {
            id: next_task_id(&tasks),
            task_type,
            params: input.params,
            status: TaskStatus::Pending,
            retry_count: 0,
            command_display: String::new(),
            logs: String::new(),
            error: None,
            result_path: None,
            created_at: now,
            updated_at: now,
        };

        tasks.push(task.clone());
        save_tasks(&state.inner.storage_path, &tasks)?;
        task
    };

    spawn_task(state.inner.clone(), task.id);
    Ok(task)
}

#[tauri::command]
fn list_tasks(state: State<'_, AppState>, task_type: Option<String>) -> Result<Vec<TaskRecord>, String> {
    let tasks = state
        .inner
        .tasks
        .lock()
        .map_err(|_| "任务锁获取失败".to_string())?;

    let parsed_type = task_type
        .as_deref()
        .map(TaskType::from_str)
        .transpose()?;

    let mut filtered: Vec<TaskRecord> = tasks
        .iter()
        .filter(|task| parsed_type.as_ref().map(|task_type| task.task_type == *task_type).unwrap_or(true))
        .cloned()
        .collect();

    filtered.sort_by(|a, b| b.created_at.cmp(&a.created_at));
    Ok(filtered)
}

#[tauri::command]
fn retry_task(state: State<'_, AppState>, task_id: u64) -> Result<TaskRecord, String> {
    let retried = {
        let mut tasks = state
            .inner
            .tasks
            .lock()
            .map_err(|_| "任务锁获取失败".to_string())?;

        let task = tasks
            .iter_mut()
            .find(|task| task.id == task_id)
            .ok_or_else(|| format!("任务 {} 不存在", task_id))?;

        if task.status == TaskStatus::Running {
            return Err("运行中的任务不能重试".to_string());
        }

        task.retry_count += 1;
        task.status = TaskStatus::Pending;
        task.logs.clear();
        task.error = None;
        task.updated_at = now_ts();
        let cloned = task.clone();
        save_tasks(&state.inner.storage_path, &tasks)?;
        cloned
    };

    spawn_task(state.inner.clone(), task_id);
    Ok(retried)
}

#[tauri::command]
fn delete_task(state: State<'_, AppState>, task_id: u64) -> Result<(), String> {
    let mut tasks = state
        .inner
        .tasks
        .lock()
        .map_err(|_| "任务锁获取失败".to_string())?;

    if let Some(task) = tasks.iter().find(|task| task.id == task_id) {
        if task.status == TaskStatus::Running {
            return Err("运行中的任务不允许删除".to_string());
        }
    } else {
        return Err(format!("任务 {} 不存在", task_id));
    }

    tasks.retain(|task| task.id != task_id);
    save_tasks(&state.inner.storage_path, &tasks)?;
    Ok(())
}

fn build_header_map(headers: &[HeaderInput]) -> HeaderMap {
    let mut map = HeaderMap::new();
    for header in headers {
        let key = header.key.trim();
        if key.is_empty() {
            continue;
        }
        if let (Ok(name), Ok(value)) = (
            HeaderName::from_bytes(key.as_bytes()),
            HeaderValue::from_str(header.value.trim()),
        ) {
            map.insert(name, value);
        }
    }
    map
}

async fn fetch_text(url: &str, headers: &[HeaderInput]) -> Result<String, String> {
    let client = reqwest::Client::new();
    let response = client
        .get(url)
        .headers(build_header_map(headers))
        .send()
        .await
        .map_err(|e| format!("请求失败: {}", e))?;

    if !response.status().is_success() {
        return Err(format!("请求失败，状态码: {}", response.status()));
    }

    response
        .text()
        .await
        .map_err(|e| format!("读取响应失败: {}", e))
}

fn normalize_url(base: &str, candidate: &str) -> String {
    if candidate.starts_with("http://") || candidate.starts_with("https://") {
        return candidate.to_string();
    }
    if let Ok(base_url) = reqwest::Url::parse(base) {
        if let Ok(joined) = base_url.join(candidate) {
            return joined.to_string();
        }
    }
    candidate.to_string()
}

fn parse_extinf_group(line: &str) -> String {
    if let Some(index) = line.find("group-title=") {
        let section = &line[index + "group-title=".len()..];
        if let Some(group) = section.strip_prefix('"') {
            if let Some(end) = group.find('"') {
                return group[..end].to_string();
            }
        }
    }
    "default".to_string()
}

fn parse_extinf_name(line: &str) -> String {
    line.split(',').last().unwrap_or("Unknown").trim().to_string()
}

fn parse_m3u_channels(base_url: &str, content: &str) -> Vec<ChannelInfo> {
    let mut channels = Vec::new();
    let mut pending_name = String::new();
    let mut pending_group = "default".to_string();

    for line in content.lines().map(|line| line.trim()).filter(|line| !line.is_empty()) {
        if line.starts_with("#EXTINF") {
            pending_name = parse_extinf_name(line);
            pending_group = parse_extinf_group(line);
            continue;
        }

        if line.starts_with('#') {
            continue;
        }

        channels.push(ChannelInfo {
            name: if pending_name.is_empty() {
                line.to_string()
            } else {
                pending_name.clone()
            },
            group: pending_group.clone(),
            url: normalize_url(base_url, line),
        });

        pending_name.clear();
        pending_group = "default".to_string();
    }

    channels
}

fn parse_attr_value(line: &str, key: &str) -> Option<String> {
    let search = format!("{}=", key);
    let start = line.find(&search)? + search.len();
    let tail = &line[start..];

    if let Some(rest) = tail.strip_prefix('"') {
        let end = rest.find('"')?;
        return Some(rest[..end].to_string());
    }

    let end = tail.find(',').unwrap_or(tail.len());
    Some(tail[..end].to_string())
}

fn parse_m3u8_manifest(base_url: &str, content: &str) -> M3u8ManifestInfo {
    let mut variants = Vec::new();
    let lines: Vec<&str> = content.lines().map(|line| line.trim()).filter(|line| !line.is_empty()).collect();

    for i in 0..lines.len() {
        let line = lines[i];
        if !line.starts_with("#EXT-X-STREAM-INF") {
            continue;
        }

        let mut next_url: Option<String> = None;
        for candidate in lines.iter().skip(i + 1) {
            if !candidate.starts_with('#') {
                next_url = Some(normalize_url(base_url, candidate));
                break;
            }
        }

        if let Some(url) = next_url {
            variants.push(M3u8VariantInfo {
                name: parse_attr_value(line, "NAME").unwrap_or_else(|| format!("variant-{}", variants.len() + 1)),
                bandwidth: parse_attr_value(line, "BANDWIDTH").and_then(|v| v.parse::<u64>().ok()),
                resolution: parse_attr_value(line, "RESOLUTION"),
                url,
            });
        }
    }

    M3u8ManifestInfo {
        is_master: !variants.is_empty(),
        variants,
    }
}

#[tauri::command]
async fn parse_playlist(request: PlaylistRequest) -> Result<PlaylistParseResponse, String> {
    let content = fetch_text(&request.url, &request.headers).await?;

    let lowered = request.url.to_lowercase();
    if lowered.ends_with(".m3u") || (content.contains("#EXTINF") && !content.contains("#EXT-X-TARGETDURATION")) {
        let channels = parse_m3u_channels(&request.url, &content);
        return Ok(PlaylistParseResponse {
            kind: "m3u".to_string(),
            channels,
            m3u8: None,
        });
    }

    let m3u8 = parse_m3u8_manifest(&request.url, &content);
    Ok(PlaylistParseResponse {
        kind: "m3u8".to_string(),
        channels: Vec::new(),
        m3u8: Some(m3u8),
    })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let data_dir = app
                .path()
                .app_data_dir()
                .unwrap_or_else(|_| std::env::current_dir().unwrap_or_else(|_| PathBuf::from(".")));
            fs::create_dir_all(&data_dir).map_err(|e| format!("创建数据目录失败: {}", e))?;

            let storage_path = data_dir.join("tasks.json");
            let repo_root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .parent()
                .and_then(|v| v.parent())
                .map(|v| v.to_path_buf())
                .unwrap_or_else(|| PathBuf::from("."));

            let cli_binary = std::env::var("MEDIA_TOOL_CLI").ok().map(PathBuf::from);
            let tasks = load_tasks(&storage_path);

            app.manage(AppState {
                inner: Arc::new(AppStateInner {
                    tasks: Mutex::new(tasks),
                    storage_path,
                    repo_root,
                    cli_binary,
                }),
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_task_types,
            create_task,
            list_tasks,
            retry_task,
            delete_task,
            parse_playlist
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
