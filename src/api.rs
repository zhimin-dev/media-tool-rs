use crate::cmd::cmd::{check_base_info_exists, clear_temp_files, cut, download as ffmpeg_download};
use crate::combine::parse::{combine_video, get_reg_file_name, get_reg_files, to_files};
use crate::common::now;
use crate::download::BaseInfo;
use crate::download::download::{create_folder, fast_download, get_file_name};
use actix_web::{web, App, HttpResponse, HttpServer, Responder};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::env;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::UNIX_EPOCH;
use tokio::sync::{RwLock, Semaphore};
use url::Url;

const DOWNLOAD_DIR: &str = "download";
const HEADER_PRESET_FILE: &str = "header_presets.json";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TaskStatus {
    Queued,
    Running,
    Success,
    Failed,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum TaskPayload {
    Download {
        url: String,
        ffmpeg_download: bool,
        target_file_name: String,
        folder: String,
        concurrent: i32,
        download_dir: String,
        #[serde(default)]
        headers: HashMap<String, String>,
    },
    Combine {
        reg_name: String,
        reg_name_start: i32,
        reg_name_end: i32,
        target_file_name: String,
        same_param_index: i32,
        set_fps: i32,
        set_a_b: i32,
        set_v_b: i32,
        set_height: i32,
        set_width: i32,
    },
    Cut {
        input: String,
        start: u32,
        duration: u32,
        target_file_name: String,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TaskRecord {
    pub id: u64,
    pub title: String,
    pub status: TaskStatus,
    pub created_at: u64,
    pub started_at: Option<u64>,
    pub finished_at: Option<u64>,
    pub command_preview: String,
    pub message: Option<String>,
    pub result_path: Option<String>,
    pub payload: TaskPayload,
}

#[derive(Debug, Deserialize)]
pub struct CreateTaskRequest {
    pub title: Option<String>,
    pub payload: TaskPayload,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HeaderPreset {
    pub id: String,
    pub name: String,
    pub host: String,
    pub headers: HashMap<String, String>,
    pub created_at: u64,
    pub updated_at: u64,
}

#[derive(Debug, Clone, Deserialize)]
pub struct HeaderEntry {
    pub key: String,
    pub value: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct CreateHeaderPresetRequest {
    pub name: String,
    pub host: String,
    pub headers: Vec<HeaderEntry>,
}

#[derive(Clone)]
struct AppState {
    tasks: Arc<RwLock<HashMap<u64, TaskRecord>>>,
    next_id: Arc<AtomicU64>,
    executor: Arc<Semaphore>,
    header_presets: Arc<RwLock<Vec<HeaderPreset>>>,
}

impl AppState {
    fn new() -> Self {
        let tasks = load_download_tasks();
        let next_id = tasks
            .keys()
            .max()
            .map(|id| id + 1)
            .unwrap_or(1);
        Self {
            tasks: Arc::new(RwLock::new(tasks)),
            next_id: Arc::new(AtomicU64::new(next_id)),
            executor: Arc::new(Semaphore::new(1)),
            header_presets: Arc::new(RwLock::new(load_header_presets())),
        }
    }
}

struct TaskOutcome {
    message: String,
    result_path: Option<String>,
}

pub async fn run_server(port: u16) -> std::io::Result<()> {
    let state = web::Data::new(AppState::new());

    println!("media-tool-rs ui api is running at http://127.0.0.1:{port}");

    HttpServer::new(move || {
        App::new()
            .app_data(state.clone())
            .route("/api/health", web::get().to(health))
            .route("/api/tasks", web::get().to(list_tasks))
            .route("/api/tasks/{id}", web::get().to(get_task))
            .route("/api/tasks", web::post().to(create_task))
            .route("/api/header-presets", web::get().to(list_header_presets))
            .route("/api/header-presets", web::post().to(create_header_preset))
    })
    .bind(("127.0.0.1", port))?
    .run()
    .await
}

async fn health() -> impl Responder {
    HttpResponse::Ok().json(serde_json::json!({
        "status": "ok",
        "timestamp": now(),
    }))
}

async fn list_tasks(state: web::Data<AppState>) -> impl Responder {
    let mut tasks = state
        .tasks
        .read()
        .await
        .values()
        .cloned()
        .collect::<Vec<_>>();
    tasks.sort_by(|left, right| right.id.cmp(&left.id));
    HttpResponse::Ok().json(tasks)
}

async fn get_task(path: web::Path<u64>, state: web::Data<AppState>) -> impl Responder {
    let id = path.into_inner();
    let tasks = state.tasks.read().await;

    match tasks.get(&id) {
        Some(task) => HttpResponse::Ok().json(task),
        None => HttpResponse::NotFound().json(serde_json::json!({
            "message": format!("task {} not found", id),
        })),
    }
}

async fn create_task(
    state: web::Data<AppState>,
    request: web::Json<CreateTaskRequest>,
) -> impl Responder {
    let payload = request.payload.clone();
    let id = state.next_id.fetch_add(1, Ordering::SeqCst);
    let task = TaskRecord {
        id,
        title: request
            .title
            .clone()
            .filter(|value| !value.trim().is_empty())
            .unwrap_or_else(|| default_title(&payload)),
        status: TaskStatus::Queued,
        created_at: now(),
        started_at: None,
        finished_at: None,
        command_preview: build_command_preview(&payload),
        message: Some("任务已创建，等待执行".to_string()),
        result_path: None,
        payload: payload.clone(),
    };

    state.tasks.write().await.insert(id, task.clone());

    let background_state = state.get_ref().clone();
    tokio::spawn(async move {
        execute_task(background_state, id, payload).await;
    });

    HttpResponse::Ok().json(task)
}

async fn execute_task(state: AppState, id: u64, payload: TaskPayload) {
    let Ok(_permit) = state.executor.clone().acquire_owned().await else {
        return;
    };

    update_task(&state, id, |task| {
        task.status = TaskStatus::Running;
        task.started_at = Some(now());
        task.message = Some("任务执行中".to_string());
    })
    .await;

    let result = match payload {
        TaskPayload::Download {
            url,
            ffmpeg_download,
            target_file_name,
            folder,
            concurrent,
            download_dir,
            headers,
        } => {
            run_download_task(
                url,
                ffmpeg_download,
                target_file_name,
                folder,
                concurrent,
                download_dir,
                headers,
            )
            .await
        }
        TaskPayload::Combine {
            reg_name,
            reg_name_start,
            reg_name_end,
            target_file_name,
            same_param_index,
            set_fps,
            set_a_b,
            set_v_b,
            set_height,
            set_width,
        } => {
            run_combine_task(
                reg_name,
                reg_name_start,
                reg_name_end,
                target_file_name,
                same_param_index,
                set_fps,
                set_a_b,
                set_v_b,
                set_height,
                set_width,
            )
            .await
        }
        TaskPayload::Cut {
            input,
            start,
            duration,
            target_file_name,
        } => run_cut_task(input, start, duration, target_file_name).await,
    };

    update_task(&state, id, |task| {
        task.finished_at = Some(now());
        match result {
            Ok(outcome) => {
                task.status = TaskStatus::Success;
                task.message = Some(outcome.message);
                task.result_path = outcome.result_path;
            }
            Err(message) => {
                task.status = TaskStatus::Failed;
                task.message = Some(message);
                task.result_path = None;
            }
        }
    })
    .await;
}

async fn update_task<F>(state: &AppState, id: u64, updater: F)
where
    F: FnOnce(&mut TaskRecord),
{
    let mut tasks = state.tasks.write().await;
    if let Some(task) = tasks.get_mut(&id) {
        updater(task);
    }
}

async fn run_download_task(
    url: String,
    ffmpeg_download_mode: bool,
    target_file_name: String,
    folder: String,
    concurrent: i32,
    download_dir: String,
    headers: HashMap<String, String>,
) -> Result<TaskOutcome, String> {
    let current_dir = env::current_dir().map_err(|error| error.to_string())?;
    ensure_directory_exists(current_dir.join(&download_dir)).map_err(|error| error.to_string())?;
    ensure_directory_exists(current_dir.join("cut")).map_err(|error| error.to_string())?;

    let folder_name = resolve_download_folder_name(&url, &folder);
    let relative_folder = format!("./{}/{}", download_dir, folder_name);
    let output_name = get_file_name(target_file_name);

    if url.trim().is_empty() && !check_base_info_exists(relative_folder.clone()) {
        return Err("url or folder is required".to_string());
    }

    create_folder(relative_folder.clone()).map_err(|error| error.to_string())?;

    let success = if ffmpeg_download_mode {
        let full_file = format!("{}/{}", relative_folder, output_name);
        ffmpeg_download(url, full_file).map_err(|_| "ffmpeg 下载失败".to_string())?
    } else {
        env::set_current_dir(Path::new(&relative_folder)).map_err(|error| error.to_string())?;
        let download_result =
            fast_download(url, output_name.clone(), folder, concurrent, headers)
                .await
                .map_err(|_| "下载失败".to_string());
        env::set_current_dir(&current_dir).map_err(|error| error.to_string())?;
        let success = download_result?;
        if success {
            let _ = clear_temp_files(relative_folder.clone());
        }
        success
    };

    if !success {
        return Err("下载任务执行失败".to_string());
    }

    let result_path = current_dir
        .join(relative_folder.trim_start_matches("./"))
        .join(output_name);

    Ok(TaskOutcome {
        message: "下载完成".to_string(),
        result_path: Some(result_path.display().to_string()),
    })
}

async fn run_combine_task(
    reg_name: String,
    reg_name_start: i32,
    reg_name_end: i32,
    target_file_name: String,
    same_param_index: i32,
    set_fps: i32,
    set_a_b: i32,
    set_v_b: i32,
    set_height: i32,
    set_width: i32,
) -> Result<TaskOutcome, String> {
    tokio::task::spawn_blocking(move || {
        let files = get_reg_files(reg_name.clone(), reg_name_start, reg_name_end)
            .map_err(|_| "解析文件失败".to_string())?;
        let file_name = to_files().map_err(|_| "生成临时文件失败".to_string())?;
        let target = if target_file_name.trim().is_empty() {
            format!("./{}", get_reg_file_name(reg_name))
        } else {
            format!("./{}", target_file_name)
        };

        let success = combine_video(
            files,
            file_name,
            target.clone(),
            same_param_index,
            set_a_b,
            set_v_b,
            set_fps,
            set_width,
            set_height,
        )
        .map_err(|_| "合并文件失败".to_string())?;

        if !success {
            return Err("合并文件失败".to_string());
        }

        let current_dir = env::current_dir().map_err(|error| error.to_string())?;
        let result_path = current_dir.join(target.trim_start_matches("./"));

        Ok(TaskOutcome {
            message: "合并完成".to_string(),
            result_path: Some(result_path.display().to_string()),
        })
    })
    .await
    .map_err(|error| error.to_string())?
}

async fn run_cut_task(
    input: String,
    start: u32,
    duration: u32,
    target_file_name: String,
) -> Result<TaskOutcome, String> {
    tokio::task::spawn_blocking(move || {
        if duration == 0 {
            return Err("duration 需要 > 0".to_string());
        }

        let current_dir = env::current_dir().map_err(|error| error.to_string())?;
        ensure_directory_exists(current_dir.join("cut")).map_err(|error| error.to_string())?;

        let target = if target_file_name.trim().is_empty() {
            format!("./cut/{}.mp4", now())
        } else {
            format!("./cut/{}", target_file_name)
        };

        let success =
            cut(input, start, duration, target.clone()).map_err(|_| "截取失败".to_string())?;
        if !success {
            return Err("截取视频失败".to_string());
        }

        Ok(TaskOutcome {
            message: "截取完成".to_string(),
            result_path: Some(
                current_dir
                    .join(target.trim_start_matches("./"))
                    .display()
                    .to_string(),
            ),
        })
    })
    .await
    .map_err(|error| error.to_string())?
}

fn ensure_directory_exists(path: PathBuf) -> std::io::Result<()> {
    if !path.exists() {
        std::fs::create_dir_all(path)?;
    }
    Ok(())
}

fn resolve_download_folder_name(url: &str, folder: &str) -> String {
    if !folder.trim().is_empty() {
        return folder.to_string();
    }

    if let Ok(parsed_url) = Url::parse(url) {
        return format!("{:x}", md5::compute(parsed_url.path()));
    }

    format!("{}", now())
}

fn default_title(payload: &TaskPayload) -> String {
    match payload {
        TaskPayload::Download { .. } => "下载任务".to_string(),
        TaskPayload::Combine { .. } => "合并任务".to_string(),
        TaskPayload::Cut { .. } => "截取任务".to_string(),
    }
}

async fn list_header_presets(state: web::Data<AppState>) -> impl Responder {
    let mut presets = state.header_presets.read().await.clone();
    presets.sort_by(|left, right| right.updated_at.cmp(&left.updated_at));
    HttpResponse::Ok().json(presets)
}

async fn create_header_preset(
    state: web::Data<AppState>,
    request: web::Json<CreateHeaderPresetRequest>,
) -> impl Responder {
    let name = request.name.trim();
    let host = request.host.trim().to_lowercase();
    if name.is_empty() || host.is_empty() {
        return HttpResponse::BadRequest().json(serde_json::json!({
            "message": "name 和 host 不能为空",
        }));
    }

    let headers = normalize_header_entries(&request.headers);
    if headers.is_empty() {
        return HttpResponse::BadRequest().json(serde_json::json!({
            "message": "至少需要一个有效 header",
        }));
    }

    let mut presets = state.header_presets.write().await;
    let timestamp = now();
    if let Some(index) = presets.iter().position(|preset| preset.host == host) {
        presets[index].name = name.to_string();
        presets[index].headers = headers.clone();
        presets[index].updated_at = timestamp;
        let preset = presets[index].clone();
        if let Err(error) = save_header_presets(&presets) {
            return HttpResponse::InternalServerError().json(serde_json::json!({
                "message": error.to_string(),
            }));
        }
        return HttpResponse::Ok().json(preset);
    }

    let preset = HeaderPreset {
        id: format!("{:x}", md5::compute(format!("{}-{}-{}", host, name, timestamp))),
        name: name.to_string(),
        host,
        headers,
        created_at: timestamp,
        updated_at: timestamp,
    };
    presets.push(preset.clone());
    if let Err(error) = save_header_presets(&presets) {
        return HttpResponse::InternalServerError().json(serde_json::json!({
            "message": error.to_string(),
        }));
    }

    HttpResponse::Ok().json(preset)
}

fn normalize_header_entries(entries: &[HeaderEntry]) -> HashMap<String, String> {
    let mut headers = HashMap::new();
    for entry in entries {
        let key = entry.key.trim();
        let value = entry.value.trim();
        if !key.is_empty() && !value.is_empty() {
            headers.insert(key.to_string(), value.to_string());
        }
    }
    headers
}

fn load_download_tasks() -> HashMap<u64, TaskRecord> {
    let mut tasks = HashMap::new();
    let Ok(current_dir) = env::current_dir() else {
        return tasks;
    };
    let download_root = current_dir.join(DOWNLOAD_DIR);
    let Ok(entries) = fs::read_dir(&download_root) else {
        return tasks;
    };

    let mut folders = entries
        .flatten()
        .filter_map(|entry| {
            let path = entry.path();
            if path.is_dir() { Some(path) } else { None }
        })
        .collect::<Vec<_>>();
    folders.sort();

    let mut id = 1u64;
    for folder_path in folders {
        let folder_name = folder_path
            .file_name()
            .map(|name| name.to_string_lossy().to_string())
            .unwrap_or_default();
        if folder_name.is_empty() {
            continue;
        }

        let created_at = folder_timestamp(&folder_path);
        let base_info = read_folder_base_info(&folder_path);
        let url = base_info
            .as_ref()
            .map(|value| value.url.clone())
            .unwrap_or_default();
        let headers = base_info
            .as_ref()
            .map(|value| value.header.clone())
            .unwrap_or_default();
        let result_path = detect_video_file(&folder_path).map(|value| value.display().to_string());
        let (status, message) = if result_path.is_some() {
            (TaskStatus::Success, "任务已从本地目录恢复".to_string())
        } else {
            (
                TaskStatus::Failed,
                "目录已恢复，但未检测到最终视频文件".to_string(),
            )
        };

        let payload = TaskPayload::Download {
            url: url.clone(),
            ffmpeg_download: false,
            target_file_name: result_path
                .as_ref()
                .and_then(|value| {
                    Path::new(value)
                        .file_name()
                        .map(|name| name.to_string_lossy().to_string())
                })
                .unwrap_or_default(),
            folder: folder_name,
            concurrent: 10,
            download_dir: DOWNLOAD_DIR.to_string(),
            headers,
        };

        tasks.insert(
            id,
            TaskRecord {
                id,
                title: "下载任务".to_string(),
                status,
                created_at,
                started_at: Some(created_at),
                finished_at: Some(created_at),
                command_preview: build_command_preview(&payload),
                message: Some(message),
                result_path,
                payload,
            },
        );
        id += 1;
    }

    tasks
}

fn read_folder_base_info(folder_path: &Path) -> Option<BaseInfo> {
    let file = folder_path.join("base_info.json");
    let content = fs::read_to_string(file).ok()?;
    serde_json::from_str::<BaseInfo>(&content).ok()
}

fn folder_timestamp(path: &Path) -> u64 {
    fs::metadata(path)
        .and_then(|metadata| metadata.modified())
        .ok()
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map(|duration| duration.as_secs())
        .unwrap_or_else(now)
}

fn detect_video_file(folder_path: &Path) -> Option<PathBuf> {
    let entries = fs::read_dir(folder_path).ok()?;
    let mut files = entries
        .flatten()
        .map(|entry| entry.path())
        .filter(|path| {
            path.is_file()
                && path
                    .extension()
                    .and_then(|value| value.to_str())
                    .map(|ext| {
                        matches!(
                            ext.to_lowercase().as_str(),
                            "mp4" | "mkv" | "mov" | "flv" | "avi" | "m4v" | "webm"
                        )
                    })
                    .unwrap_or(false)
        })
        .collect::<Vec<_>>();
    files.sort();
    files.pop()
}

fn load_header_presets() -> Vec<HeaderPreset> {
    let Ok(content) = fs::read_to_string(HEADER_PRESET_FILE) else {
        return Vec::new();
    };
    serde_json::from_str(&content).unwrap_or_default()
}

fn save_header_presets(presets: &[HeaderPreset]) -> std::io::Result<()> {
    let data = serde_json::to_string_pretty(presets)?;
    fs::write(HEADER_PRESET_FILE, data)
}

fn build_command_preview(payload: &TaskPayload) -> String {
    match payload {
        TaskPayload::Download {
            url,
            ffmpeg_download,
            target_file_name,
            folder,
            concurrent,
            download_dir,
            headers,
        } => {
            let mut parts = vec!["media-tool-rs download".to_string()];
            if !url.trim().is_empty() {
                parts.push(format!("--url={}", url));
            }
            if *ffmpeg_download {
                parts.push("--ffmpeg_download".to_string());
            }
            if !target_file_name.trim().is_empty() {
                parts.push(format!("--target_file_name={}", target_file_name));
            }
            if !folder.trim().is_empty() {
                parts.push(format!("--folder={}", folder));
            }
            if *concurrent != 10 {
                parts.push(format!("--concurrent={}", concurrent));
            }
            if download_dir != "download" {
                parts.push(format!("--download_dir={}", download_dir));
            }
            for (key, value) in headers {
                parts.push(format!("--header {}:{}", key, value));
            }
            parts.join(" ")
        }
        TaskPayload::Combine {
            reg_name,
            reg_name_start,
            reg_name_end,
            target_file_name,
            same_param_index,
            set_fps,
            set_a_b,
            set_v_b,
            set_height,
            set_width,
        } => {
            let mut parts = vec![
                "media-tool-rs combine".to_string(),
                format!("-r {}", reg_name),
                format!("--reg-file-start={}", reg_name_start),
                format!("--reg-file-end={}", reg_name_end),
            ];
            if !target_file_name.trim().is_empty() {
                parts.push(format!("--target_file_name={}", target_file_name));
            }
            if *same_param_index >= 0 {
                parts.push(format!("--same_param_index={}", same_param_index));
            }
            if *set_fps > 0 {
                parts.push(format!("--set_fps={}", set_fps));
            }
            if *set_a_b > 0 {
                parts.push(format!("--set_a_b={}", set_a_b));
            }
            if *set_v_b > 0 {
                parts.push(format!("--set_v_b={}", set_v_b));
            }
            if *set_width > 0 {
                parts.push(format!("--set_width={}", set_width));
            }
            if *set_height > 0 {
                parts.push(format!("--set_height={}", set_height));
            }
            parts.join(" ")
        }
        TaskPayload::Cut {
            input,
            start,
            duration,
            target_file_name,
        } => {
            let mut parts = vec![
                "media-tool-rs cut".to_string(),
                format!("-i={}", input),
                format!("-s={}", start),
                format!("-d={}", duration),
            ];
            if !target_file_name.trim().is_empty() {
                parts.push(format!("--target_file_name={}", target_file_name));
            }
            parts.join(" ")
        }
    }
}
