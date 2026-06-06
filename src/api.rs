use crate::cmd::cmd::{check_base_info_exists, clear_temp_files, cut, download as ffmpeg_download};
use crate::combine::parse::{combine_video, get_reg_files, to_files};
use crate::common::now;
use crate::download::download::{create_folder, fast_download, get_file_name};
use crate::download::BaseInfo;
use actix_cors::Cors;
use actix_files::{Files, NamedFile};
use actix_web::{web, App, HttpRequest, HttpResponse, HttpServer, Responder};
use futures_util::StreamExt;
use serde::{de::Error as DeError, Deserialize, Deserializer, Serialize};
use std::collections::HashMap;
use std::env;
use std::fs;
use std::net::TcpListener;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};
use tokio::fs::{File, OpenOptions};
use tokio::io::AsyncWriteExt;
use tokio::sync::{RwLock, Semaphore};
use url::Url;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum TaskStatus {
    Queued,
    Running,
    Success,
    Failed,
}

#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "snake_case")]
enum TaskKind {
    Download,
    Combine,
    Cut,
    Transcode,
}

impl TaskKind {
    fn file_name(self) -> &'static str {
        match self {
            TaskKind::Download => "download_tasks.json",
            TaskKind::Combine => "combine_tasks.json",
            TaskKind::Cut => "cut_tasks.json",
            TaskKind::Transcode => "transcode_tasks.json",
        }
    }

    fn matches_payload(self, payload: &TaskPayload) -> bool {
        matches!(
            (self, payload),
            (TaskKind::Download, TaskPayload::Download { .. })
                | (TaskKind::Combine, TaskPayload::Combine { .. })
                | (TaskKind::Cut, TaskPayload::Cut { .. })
                | (TaskKind::Cut, TaskPayload::CutBatch { .. })
                | (TaskKind::Transcode, TaskPayload::Transcode { .. })
        )
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum TaskPayload {
    Download {
        url: String,
        ffmpeg_download: bool,
        #[serde(default = "default_auto_clear_temp_files")]
        auto_clear_temp_files: bool,
        target_file_name: String,
        folder: String,
        concurrent: i32,
        download_dir: String,
        #[serde(default)]
        headers: HashMap<String, String>,
        #[serde(default = "default_combine_retry_count")]
        combine_retry_count: i32,
    },
    Combine {
        #[serde(default)]
        inputs: Vec<String>,
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
        #[serde(default)]
        delete_input_file: bool,
    },
    CutBatch {
        input: String,
        #[serde(default)]
        delete_input_file: bool,
        segments: Vec<CutSegment>,
    },
    Transcode {
        input: String,
        #[serde(default)]
        target_file_name: String,
        #[serde(default = "default_video_codec")]
        video_codec: String,
        #[serde(default)]
        resolution: String,
        #[serde(default)]
        video_bitrate_kbps: i32,
        #[serde(default)]
        fps: i32,
        #[serde(default = "default_audio_codec")]
        audio_codec: String,
        #[serde(default)]
        audio_bitrate_kbps: i32,
        #[serde(default)]
        audio_channels: i32,
        #[serde(default)]
        audio_sample_rate: i32,
    },
}

fn default_video_codec() -> String {
    "h264".to_string()
}

fn default_audio_codec() -> String {
    "aac".to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CutSegment {
    pub start: u32,
    pub duration: u32,
    pub target_file_name: String,
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
    #[serde(default)]
    pub parent_id: Option<u64>,
    #[serde(default)]
    pub child_task_ids: Vec<u64>,
    pub payload: TaskPayload,
}

#[derive(Debug, Deserialize)]
pub struct CreateTaskRequest {
    pub title: Option<String>,
    pub payload: TaskPayload,
}

#[derive(Debug, Deserialize)]
pub struct CreateCutBatchRequest {
    pub title: Option<String>,
    pub input: String,
    #[serde(default)]
    pub delete_input_file: bool,
    #[serde(default)]
    pub segments: Vec<CutSegment>,
}

#[derive(Debug, Serialize)]
pub struct TaskDetailResponse {
    pub task: TaskRecord,
    pub output_dir: Option<String>,
    pub output_files: Vec<String>,
    pub base_info: Option<BaseInfo>,
    pub child_tasks: Vec<TaskRecord>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateTaskBaseInfoRequest {
    pub url: String,
    #[serde(default)]
    pub m3u8_name: String,
    #[serde(default)]
    pub header: HashMap<String, String>,
    #[serde(default)]
    pub target_file_name: String,
    #[serde(default)]
    pub concurrent: i32,
    #[serde(default)]
    pub download_dir: String,
    #[serde(default)]
    pub ffmpeg_download: bool,
    #[serde(default = "default_auto_clear_temp_files")]
    pub auto_clear_temp_files: bool,
    #[serde(default = "default_combine_retry_count")]
    pub combine_retry_count: i32,
}

fn default_auto_clear_temp_files() -> bool {
    true
}

fn default_combine_retry_count() -> i32 {
    3
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HeaderPreset {
    pub host: String,
    #[serde(default)]
    pub headers: HashMap<String, String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TranscodePreset {
    pub title: String,
    #[serde(default = "default_video_codec")]
    pub video_codec: String,
    #[serde(default)]
    pub resolution: String,
    #[serde(default)]
    pub video_bitrate_kbps: i32,
    #[serde(default)]
    pub fps: i32,
    #[serde(default = "default_audio_codec")]
    pub audio_codec: String,
    #[serde(default)]
    pub audio_bitrate_kbps: i32,
    #[serde(default)]
    pub audio_channels: i32,
    #[serde(default)]
    pub audio_sample_rate: i32,
}

#[derive(Debug, Deserialize)]
pub struct VideoProbeRequest {
    pub input: String,
}

#[derive(Debug, Serialize)]
pub struct VideoProbeResponse {
    pub format_name: String,
    pub duration_seconds: Option<f64>,
    pub size_bytes: Option<u64>,
    pub overall_bitrate: Option<u64>,
    pub video_codec: Option<String>,
    pub width: Option<i32>,
    pub height: Option<i32>,
    pub fps: Option<f64>,
    pub video_bitrate: Option<u64>,
    pub audio_codec: Option<String>,
    pub audio_channels: Option<i32>,
    pub audio_sample_rate: Option<i32>,
    pub audio_bitrate: Option<u64>,
}

#[derive(Clone)]
struct AppState {
    tasks: Arc<RwLock<HashMap<u64, TaskRecord>>>,
    next_id: Arc<AtomicU64>,
    executor: Arc<Semaphore>,
    header_presets: Arc<RwLock<Vec<HeaderPreset>>>,
    header_presets_path: Arc<PathBuf>,
    transcode_presets: Arc<RwLock<Vec<TranscodePreset>>>,
    transcode_presets_path: Arc<PathBuf>,
    tasks_config_dir: Arc<PathBuf>,
}

impl AppState {
    fn new() -> Self {
        let current_dir = env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
        let tasks_config_dir = current_dir.join("config").join("tasks");
        if let Err(error) = ensure_task_files(&tasks_config_dir) {
            println!("failed to initialize task config files: {}", error);
        }
        let mut tasks = load_tasks_from_config(&tasks_config_dir);
        if tasks.is_empty() {
            tasks = load_download_tasks(current_dir.join("static").join("download"));
            let _ = write_tasks_to_config(&tasks_config_dir, &tasks);
        }
        let next_id = tasks.keys().copied().max().unwrap_or(0) + 1;
        let header_presets_path = current_dir.join("config").join("header_presets.json");
        if let Err(error) = ensure_header_presets_file(&header_presets_path) {
            println!("failed to initialize config/header_presets.json: {}", error);
        }
        let transcode_presets_path = current_dir.join("config").join("transcode_presets.json");
        if let Err(error) = ensure_transcode_presets_file(&transcode_presets_path) {
            println!(
                "failed to initialize config/transcode_presets.json: {}",
                error
            );
        }
        Self {
            tasks: Arc::new(RwLock::new(tasks)),
            next_id: Arc::new(AtomicU64::new(next_id)),
            executor: Arc::new(Semaphore::new(1)),
            header_presets: Arc::new(RwLock::new(load_header_presets(&header_presets_path))),
            header_presets_path: Arc::new(header_presets_path),
            transcode_presets: Arc::new(RwLock::new(load_transcode_presets(&transcode_presets_path))),
            transcode_presets_path: Arc::new(transcode_presets_path),
            tasks_config_dir: Arc::new(tasks_config_dir),
        }
    }
}

struct TaskOutcome {
    message: String,
    result_path: Option<String>,
}

pub async fn run_server(port: u16) -> std::io::Result<()> {
    let listener = TcpListener::bind(("127.0.0.1", port))?;
    let addr = listener.local_addr()?;
    let actual_port = addr.port();
    let state = web::Data::new(AppState::new());
    ensure_static_dirs();
    write_runtime_server_info(actual_port);

    println!(
        "media-tool-rs ui api is running at http://127.0.0.1:{actual_port}"
    );

    HttpServer::new(move || {
        App::new()
            .wrap(Cors::permissive())
            .app_data(state.clone())
            .app_data(web::PayloadConfig::new(1024 * 1024 * 1024))
            .route("/api/health", web::get().to(health))
            .route("/api/tasks", web::get().to(list_tasks))
            .route("/api/tasks/{id}", web::get().to(get_task))
            .route("/api/tasks", web::post().to(create_task))
            .route(
                "/api/tasks/cut-batch",
                web::post().to(create_cut_batch_task),
            )
            .route("/api/tasks/{id}/detail", web::get().to(get_task_detail))
            .route("/api/tasks/{id}/retry", web::post().to(retry_task))
            .route(
                "/api/tasks/{id}/base-info",
                web::put().to(update_task_base_info),
            )
            .route("/api/tasks/{id}", web::delete().to(delete_task))
            .route("/api/header-presets", web::get().to(list_header_presets))
            .route("/api/header-presets", web::post().to(save_header_preset))
            .route(
                "/api/header-presets/{host}",
                web::delete().to(delete_header_preset),
            )
            .route(
                "/api/tasks/{id}/clear-temp",
                web::post().to(clear_task_temp_files),
            )
            .route(
                "/api/tasks/{id}/clear-combine-unused",
                web::post().to(clear_combine_unused_files),
            )
            .route("/api/upload-video", web::post().to(upload_video))
            .route("/api/video-probe", web::post().to(probe_video))
            .route("/api/serve-video", web::get().to(serve_video))
            .route("/api/transcode-presets", web::get().to(list_transcode_presets))
            .route("/api/transcode-presets", web::post().to(save_transcode_preset))
            .route(
                "/api/transcode-presets/{title}",
                web::delete().to(delete_transcode_preset),
            )
            .service(Files::new("/static", "./static").disable_content_disposition())
    })
    .listen(listener)?
    .run()
    .await
}

fn ensure_static_dirs() {
    let current_dir = match env::current_dir() {
        Ok(dir) => dir,
        Err(error) => {
            println!("failed to resolve current dir for static dirs: {}", error);
            return;
        }
    };

    for relative in ["static", "static/download", "static/cut", "static/uploads"] {
        let path = current_dir.join(relative);
        if let Err(error) = fs::create_dir_all(&path) {
            println!("failed to create static dir {}: {}", path.display(), error);
        }
    }
}

fn write_runtime_server_info(port: u16) {
    let current_dir = match env::current_dir() {
        Ok(dir) => dir,
        Err(error) => {
            println!("failed to resolve current dir for runtime server info: {}", error);
            return;
        }
    };

    let runtime_dir = current_dir.join("config").join("runtime");
    if let Err(error) = fs::create_dir_all(&runtime_dir) {
        println!("failed to create runtime config dir: {}", error);
        return;
    }

    let server_info_path = runtime_dir.join("server-info.json");
    let payload = serde_json::json!({
        "host": "127.0.0.1",
        "port": port,
        "api_base": format!("http://127.0.0.1:{}/api", port),
        "static_base": format!("http://127.0.0.1:{}/static", port),
    });
    if let Err(error) = fs::write(&server_info_path, payload.to_string()) {
        println!(
            "failed to write runtime server info to {}: {}",
            server_info_path.display(),
            error
        );
    }
}

async fn health() -> impl Responder {
    HttpResponse::Ok().json(serde_json::json!({
        "status": "ok",
        "timestamp": now(),
    }))
}

#[derive(Deserialize)]
struct ServeVideoQuery {
    path: String,
}

#[derive(Deserialize)]
struct UploadVideoQuery {
    #[serde(default)]
    file_name: String,
    #[serde(default)]
    sub_dir: String,
    #[serde(default)]
    root_dir: String,
    #[serde(default, deserialize_with = "deserialize_bool_like")]
    preserve_file_name: bool,
}

#[derive(Serialize)]
struct UploadVideoResponse {
    path: String,
}

#[derive(Debug, Deserialize)]
struct ListTasksQuery {
    kind: Option<TaskKind>,
}

async fn upload_video(
    query: web::Query<UploadVideoQuery>,
    mut payload: web::Payload,
) -> impl Responder {
    let current_dir = match env::current_dir() {
        Ok(dir) => dir,
        Err(error) => return HttpResponse::InternalServerError().body(error.to_string()),
    };

    let upload_sub_dir = sanitize_upload_sub_dir(&query.sub_dir);
    let upload_root_dir = resolve_upload_root_dir(&query.root_dir);
    let upload_dir = if upload_sub_dir.as_os_str().is_empty() {
        current_dir.join("static").join(upload_root_dir)
    } else {
        current_dir
            .join("static")
            .join(upload_root_dir)
            .join(upload_sub_dir)
    };
    if let Err(error) = ensure_directory_exists(upload_dir.clone()) {
        return HttpResponse::InternalServerError().body(error.to_string());
    }

    let sanitized_file_name = sanitize_upload_file_name(&query.file_name);
    let extension = Path::new(&sanitized_file_name)
        .extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| ext.to_ascii_lowercase())
        .filter(|ext| !ext.is_empty())
        .unwrap_or_else(|| "mp4".to_string());

    let (mut temp_file, temp_path) = match create_upload_temp_file(&upload_dir).await {
        Ok(tuple) => tuple,
        Err(error) => return HttpResponse::InternalServerError().body(error.to_string()),
    };
    let mut has_data = false;
    let mut digest = md5::Context::new();

    while let Some(chunk_result) = payload.next().await {
        let chunk = match chunk_result {
            Ok(chunk) => chunk,
            Err(error) => {
                let _ = tokio::fs::remove_file(&temp_path).await;
                return HttpResponse::BadRequest().body(error.to_string());
            }
        };
        if !chunk.is_empty() {
            has_data = true;
            digest.consume(&chunk);
        }
        if let Err(error) = temp_file.write_all(&chunk).await {
            let _ = tokio::fs::remove_file(&temp_path).await;
            return HttpResponse::InternalServerError().body(error.to_string());
        }
    }
    if !has_data {
        let _ = tokio::fs::remove_file(&temp_path).await;
        return HttpResponse::BadRequest().body("empty file");
    }
    if let Err(error) = temp_file.flush().await {
        let _ = tokio::fs::remove_file(&temp_path).await;
        return HttpResponse::InternalServerError().body(error.to_string());
    }
    drop(temp_file);

    let target_name = if query.preserve_file_name {
        sanitized_file_name
    } else {
        format!("{:x}.{}", digest.finalize(), extension)
    };
    let target_path = upload_dir.join(target_name);
    if target_path.exists() {
        if let Err(error) = fs::remove_file(&target_path) {
            let _ = tokio::fs::remove_file(&temp_path).await;
            return HttpResponse::InternalServerError().body(error.to_string());
        }
    }
    if let Err(error) = fs::rename(&temp_path, &target_path) {
        let _ = tokio::fs::remove_file(&temp_path).await;
        return HttpResponse::InternalServerError().body(error.to_string());
    }

    HttpResponse::Ok().json(UploadVideoResponse {
        path: target_path.display().to_string(),
    })
}

async fn probe_video(request: web::Json<VideoProbeRequest>) -> impl Responder {
    let input = request.input.trim().to_string();
    if input.is_empty() {
        return HttpResponse::BadRequest().json(serde_json::json!({
            "message": "输入文件不能为空",
        }));
    }

    let result = tokio::task::spawn_blocking(move || probe_video_with_ffprobe(&input)).await;
    match result {
        Ok(Ok(response)) => HttpResponse::Ok().json(response),
        Ok(Err(message)) => {
            HttpResponse::BadRequest().json(serde_json::json!({ "message": message }))
        }
        Err(error) => HttpResponse::InternalServerError()
            .json(serde_json::json!({ "message": error.to_string() })),
    }
}

fn deserialize_bool_like<'de, D>(deserializer: D) -> Result<bool, D::Error>
where
    D: Deserializer<'de>,
{
    let value = String::deserialize(deserializer)?;
    match value.trim().to_ascii_lowercase().as_str() {
        "true" | "1" | "yes" | "on" => Ok(true),
        "false" | "0" | "no" | "off" => Ok(false),
        _ => Err(DeError::custom(
            "provided string was not a supported boolean value",
        )),
    }
}

async fn serve_video(query: web::Query<ServeVideoQuery>, req: HttpRequest) -> HttpResponse {
    let requested_path = PathBuf::from(&query.path);

    // Security: only allow absolute paths (no path traversal via relative paths)
    if !requested_path.is_absolute() {
        return HttpResponse::Forbidden().body("only absolute paths are allowed");
    }

    // Security: reject any path containing parent directory components
    if requested_path
        .components()
        .any(|c| matches!(c, std::path::Component::ParentDir))
    {
        return HttpResponse::Forbidden().body("path traversal not allowed");
    }

    if !requested_path.is_file() {
        return HttpResponse::NotFound().body("file not found");
    }

    let extension = requested_path
        .extension()
        .and_then(|ext| ext.to_str())
        .unwrap_or("")
        .to_lowercase();

    const ALLOWED_EXTENSIONS: [&str; 6] = ["mp4", "mkv", "mov", "avi", "webm", "m4v"];
    if !ALLOWED_EXTENSIONS.contains(&extension.as_str()) {
        return HttpResponse::Forbidden().body("unsupported file type");
    }

    match NamedFile::open(&requested_path) {
        Ok(file) => file.disable_content_disposition().into_response(&req),
        Err(_) => HttpResponse::InternalServerError().body("failed to read file"),
    }
}

async fn list_tasks(
    query: web::Query<ListTasksQuery>,
    state: web::Data<AppState>,
) -> impl Responder {
    let mut tasks = state
        .tasks
        .read()
        .await
        .values()
        .filter(|task| {
            query
                .kind
                .map(|kind| kind.matches_payload(&task.payload))
                .unwrap_or(true)
        })
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
    let id = state.next_id.fetch_add(1, Ordering::SeqCst);
    let task = build_task_record(id, request.title.clone(), request.payload.clone());
    let payload = task.payload.clone();

    {
        let mut tasks = state.tasks.write().await;
        tasks.insert(id, task.clone());
    }
    if let Err(error) = persist_tasks(&state).await {
        return HttpResponse::InternalServerError().json(serde_json::json!({
            "message": format!("保存任务配置失败: {}", error),
        }));
    }

    let background_state = state.get_ref().clone();
    tokio::spawn(async move {
        execute_task(background_state, id, payload).await;
    });

    HttpResponse::Ok().json(task)
}

async fn create_cut_batch_task(
    state: web::Data<AppState>,
    request: web::Json<CreateCutBatchRequest>,
) -> impl Responder {
    let input = request.input.trim().to_string();
    if input.is_empty() {
        return HttpResponse::BadRequest().json(serde_json::json!({
            "message": "输入文件不能为空",
        }));
    }
    if request.segments.is_empty() {
        return HttpResponse::BadRequest().json(serde_json::json!({
            "message": "至少需要一个子任务",
        }));
    }
    if request.segments.iter().any(|segment| segment.duration == 0) {
        return HttpResponse::BadRequest().json(serde_json::json!({
            "message": "子任务持续时长必须大于 0",
        }));
    }

    let parent_id = state.next_id.fetch_add(1, Ordering::SeqCst);
    let payload = TaskPayload::CutBatch {
        input: input.clone(),
        delete_input_file: request.delete_input_file,
        segments: request.segments.clone(),
    };
    let parent_title = request
        .title
        .clone()
        .filter(|value| !value.trim().is_empty())
        .or_else(|| {
            Path::new(&input)
                .file_name()
                .map(|name| name.to_string_lossy().to_string())
        });
    let mut parent_task = build_task_record(parent_id, parent_title, payload.clone());
    let child_tasks = build_cut_child_tasks(
        parent_id,
        input,
        request.delete_input_file,
        &request.segments,
        &state,
    );
    parent_task.child_task_ids = child_tasks.iter().map(|task| task.id).collect();
    parent_task.message = Some(format!(
        "已创建 {} 个子任务，等待执行",
        parent_task.child_task_ids.len()
    ));

    {
        let mut tasks = state.tasks.write().await;
        tasks.insert(parent_id, parent_task.clone());
        for child_task in child_tasks {
            tasks.insert(child_task.id, child_task);
        }
    }
    if let Err(error) = persist_tasks(&state).await {
        return HttpResponse::InternalServerError().json(serde_json::json!({
            "message": format!("保存任务配置失败: {}", error),
        }));
    }

    let background_state = state.get_ref().clone();
    tokio::spawn(async move {
        execute_task(background_state, parent_id, payload).await;
    });

    HttpResponse::Ok().json(parent_task)
}

async fn get_task_detail(path: web::Path<u64>, state: web::Data<AppState>) -> impl Responder {
    let id = path.into_inner();
    let task = {
        let tasks = state.tasks.read().await;
        tasks.get(&id).cloned()
    };

    let Some(task) = task else {
        return HttpResponse::NotFound().json(serde_json::json!({
            "message": format!("task {} not found", id),
        }));
    };

    let child_tasks = {
        let tasks = state.tasks.read().await;
        let mut records = task
            .child_task_ids
            .iter()
            .filter_map(|child_id| tasks.get(child_id).cloned())
            .collect::<Vec<_>>();
        records.sort_by(|left, right| left.id.cmp(&right.id));
        records
    };
    let (output_dir, output_files) = resolve_task_output_detail(&task);
    let base_info = resolve_task_directory(&task).and_then(|path| read_task_base_info(&path));
    HttpResponse::Ok().json(TaskDetailResponse {
        task,
        output_dir,
        output_files,
        base_info,
        child_tasks,
    })
}

async fn retry_task(path: web::Path<u64>, state: web::Data<AppState>) -> impl Responder {
    let source_id = path.into_inner();
    let source_task = {
        let tasks = state.tasks.read().await;
        tasks.get(&source_id).cloned()
    };

    let Some(source_task) = source_task else {
        return HttpResponse::NotFound().json(serde_json::json!({
            "message": format!("task {} not found", source_id),
        }));
    };

    if let TaskPayload::CutBatch {
        input,
        delete_input_file,
        segments,
    } = source_task.payload.clone()
    {
        let parent_id = state.next_id.fetch_add(1, Ordering::SeqCst);
        let payload = TaskPayload::CutBatch {
            input: input.clone(),
            delete_input_file,
            segments: segments.clone(),
        };
        let mut parent_task = build_task_record(
            parent_id,
            Some(format!("{}（重试）", source_task.title)),
            payload.clone(),
        );
        let child_tasks =
            build_cut_child_tasks(parent_id, input, delete_input_file, &segments, &state);
        parent_task.child_task_ids = child_tasks.iter().map(|task| task.id).collect();
        parent_task.message = Some(format!(
            "已创建 {} 个子任务，等待执行",
            parent_task.child_task_ids.len()
        ));

        {
            let mut tasks = state.tasks.write().await;
            tasks.remove(&source_id);
            for child_id in &source_task.child_task_ids {
                tasks.remove(child_id);
            }
            tasks.insert(parent_id, parent_task.clone());
            for child_task in child_tasks {
                tasks.insert(child_task.id, child_task);
            }
        }
        if let Err(error) = persist_tasks(&state).await {
            return HttpResponse::InternalServerError().json(serde_json::json!({
                "message": format!("保存任务配置失败: {}", error),
            }));
        }

        let background_state = state.get_ref().clone();
        tokio::spawn(async move {
            execute_task(background_state, parent_id, payload).await;
        });

        return HttpResponse::Ok().json(parent_task);
    }

    let id = state.next_id.fetch_add(1, Ordering::SeqCst);
    let retry_dir = resolve_task_directory(&source_task);
    let payload = hydrate_retry_payload(source_task.payload, retry_dir);
    let task = build_task_record(id, Some(format!("{}（重试）", source_task.title)), payload);
    let payload = task.payload.clone();
    {
        let mut tasks = state.tasks.write().await;
        tasks.remove(&source_id);
        tasks.insert(id, task.clone());
    }
    if let Err(error) = persist_tasks(&state).await {
        return HttpResponse::InternalServerError().json(serde_json::json!({
            "message": format!("保存任务配置失败: {}", error),
        }));
    }

    let background_state = state.get_ref().clone();
    tokio::spawn(async move {
        execute_task(background_state, id, payload).await;
    });

    HttpResponse::Ok().json(task)
}

async fn update_task_base_info(
    path: web::Path<u64>,
    state: web::Data<AppState>,
    request: web::Json<UpdateTaskBaseInfoRequest>,
) -> impl Responder {
    let id = path.into_inner();
    let task = {
        let tasks = state.tasks.read().await;
        tasks.get(&id).cloned()
    };

    let Some(task) = task else {
        return HttpResponse::NotFound().json(serde_json::json!({
            "message": format!("task {} not found", id),
        }));
    };

    if task.status != TaskStatus::Failed {
        return HttpResponse::BadRequest().json(serde_json::json!({
            "message": "仅支持编辑失败任务",
        }));
    }

    let (folder, request_download_dir, current_headers) = match task.payload {
        TaskPayload::Download {
            folder,
            download_dir,
            headers,
            ..
        } => (folder, download_dir, headers),
        _ => {
            return HttpResponse::BadRequest().json(serde_json::json!({
                "message": "仅下载任务支持编辑 base_info.json",
            }))
        }
    };

    let normalized_headers = if request.header.is_empty() {
        normalize_headers(current_headers)
    } else {
        normalize_headers(request.header.clone())
    };
    let concurrent = if request.concurrent > 0 {
        request.concurrent
    } else {
        10
    };
    let download_dir = if request.download_dir.trim().is_empty() {
        request_download_dir
    } else {
        request.download_dir.trim().to_string()
    };

    let base_info = BaseInfo {
        url: request.url.clone(),
        m3u8_name: request.m3u8_name.clone(),
        header: normalized_headers.clone(),
        target_file_name: request.target_file_name.clone(),
        folder: folder.clone(),
        concurrent,
        download_dir: download_dir.clone(),
        ffmpeg_download: request.ffmpeg_download,
        auto_clear_temp_files: request.auto_clear_temp_files,
        combine_retry_count: request.combine_retry_count,
    };

    let current_dir = match env::current_dir() {
        Ok(path) => path,
        Err(error) => {
            return HttpResponse::InternalServerError().json(serde_json::json!({
                "message": format!("读取当前目录失败: {}", error),
            }))
        }
    };
    let folder_path = current_dir.join(&download_dir).join(&folder);
    if let Err(error) = ensure_directory_exists(folder_path.clone()) {
        return HttpResponse::InternalServerError().json(serde_json::json!({
            "message": format!("确保任务目录失败: {}", error),
        }));
    }
    if let Err(error) = write_base_info(&folder_path, &base_info) {
        return HttpResponse::InternalServerError().json(serde_json::json!({
            "message": format!("写入 base_info.json 失败: {}", error),
        }));
    }

    if let Err(error) = update_task(&state, id, |record| {
        record.payload = TaskPayload::Download {
            url: base_info.url.clone(),
            ffmpeg_download: base_info.ffmpeg_download,
            auto_clear_temp_files: base_info.auto_clear_temp_files,
            target_file_name: base_info.target_file_name.clone(),
            folder: base_info.folder.clone(),
            concurrent: base_info.concurrent,
            download_dir: base_info.download_dir.clone(),
            headers: base_info.header.clone(),
            combine_retry_count: base_info.combine_retry_count,
        };
        record.command_preview = build_command_preview(&record.payload);
        record.message = Some("base_info.json 已更新，可重试".to_string());
    })
    .await
    {
        return HttpResponse::InternalServerError().json(serde_json::json!({
            "message": format!("保存任务配置失败: {}", error),
        }));
    }

    let updated = {
        let tasks = state.tasks.read().await;
        tasks.get(&id).cloned()
    };

    match updated {
        Some(task) => HttpResponse::Ok().json(task),
        None => HttpResponse::NotFound().json(serde_json::json!({
            "message": format!("task {} not found", id),
        })),
    }
}

async fn delete_task(path: web::Path<u64>, state: web::Data<AppState>) -> impl Responder {
    let id = path.into_inner();
    let task = {
        let tasks = state.tasks.read().await;
        tasks.get(&id).cloned()
    };

    let Some(task) = task else {
        return HttpResponse::NotFound().json(serde_json::json!({
            "message": format!("task {} not found", id),
        }));
    };

    let related_tasks = {
        let tasks = state.tasks.read().await;
        let mut records = vec![task.clone()];
        for child_id in &task.child_task_ids {
            if let Some(child_task) = tasks.get(child_id).cloned() {
                records.push(child_task);
            }
        }
        records
    };

    for related_task in &related_tasks {
        if let Err(error) = cleanup_task_artifacts(related_task) {
            return HttpResponse::InternalServerError().json(serde_json::json!({
                "message": format!("删除任务文件失败: {}", error),
            }));
        }
    }

    {
        let mut tasks = state.tasks.write().await;
        tasks.remove(&id);
        for child_id in &task.child_task_ids {
            tasks.remove(child_id);
        }
    }
    if let Err(error) = persist_tasks(&state).await {
        return HttpResponse::InternalServerError().json(serde_json::json!({
            "message": format!("保存任务配置失败: {}", error),
        }));
    }
    HttpResponse::Ok().json(task)
}

async fn clear_task_temp_files(path: web::Path<u64>, state: web::Data<AppState>) -> impl Responder {
    let id = path.into_inner();
    let task = {
        let tasks = state.tasks.read().await;
        tasks.get(&id).cloned()
    };

    let Some(task) = task else {
        return HttpResponse::NotFound().json(serde_json::json!({
            "message": format!("task {} not found", id),
        }));
    };

    let Some(folder_path) = resolve_task_directory(&task) else {
        return HttpResponse::BadRequest().json(serde_json::json!({
            "message": "该任务不支持清理临时文件",
        }));
    };

    if !folder_path.is_dir() {
        return HttpResponse::Ok().json(serde_json::json!({ "message": "目录不存在，无需清理" }));
    }

    let result = tokio::task::spawn_blocking(move || {
        const TEMP_EXTENSIONS: [&str; 3] = ["ts", "m3u8", "txt"];
        let entries = match fs::read_dir(&folder_path) {
            Ok(entries) => entries,
            Err(error) => return Err(error.to_string()),
        };
        for entry in entries.filter_map(|entry| entry.ok()) {
            let entry_path = entry.path();
            if !entry_path.is_file() {
                continue;
            }
            if let Some(ext) = entry_path.extension().and_then(|ext| ext.to_str()) {
                if TEMP_EXTENSIONS.contains(&ext) {
                    let _ = fs::remove_file(&entry_path);
                }
            }
        }
        Ok(())
    })
    .await;

    match result {
        Ok(Ok(())) => HttpResponse::Ok().json(serde_json::json!({ "message": "临时文件已清理" })),
        Ok(Err(message)) => {
            HttpResponse::InternalServerError().json(serde_json::json!({ "message": message }))
        }
        Err(error) => HttpResponse::InternalServerError()
            .json(serde_json::json!({ "message": error.to_string() })),
    }
}

async fn clear_combine_unused_files(
    path: web::Path<u64>,
    state: web::Data<AppState>,
) -> impl Responder {
    let id = path.into_inner();
    let task = {
        let tasks = state.tasks.read().await;
        tasks.get(&id).cloned()
    };

    let Some(task) = task else {
        return HttpResponse::NotFound().json(serde_json::json!({
            "message": format!("task {} not found", id),
        }));
    };

    if task.status != TaskStatus::Success {
        return HttpResponse::BadRequest().json(serde_json::json!({
            "message": "仅支持清理成功的合并任务",
        }));
    }

    let TaskPayload::Combine {
        target_file_name, ..
    } = &task.payload
    else {
        return HttpResponse::BadRequest().json(serde_json::json!({
            "message": "仅合并任务支持清理无用文件",
        }));
    };

    let target_file_name = target_file_name.clone();
    if target_file_name.trim().is_empty() {
        return HttpResponse::BadRequest().json(serde_json::json!({
            "message": "未填写输出文件名，跳过清理",
        }));
    }

    let Some(result_path) = task.result_path else {
        return HttpResponse::BadRequest().json(serde_json::json!({
            "message": "任务结果路径不存在",
        }));
    };

    let output_dir = Path::new(&result_path)
        .parent()
        .map(|path| path.to_path_buf())
        .unwrap_or_else(|| PathBuf::from("."));
    if !output_dir.is_dir() {
        return HttpResponse::Ok().json(serde_json::json!({ "message": "目录不存在，无需清理" }));
    }

    let keep_file_name = Path::new(&get_file_name(target_file_name))
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("")
        .to_string();
    if keep_file_name.is_empty() {
        return HttpResponse::BadRequest().json(serde_json::json!({
            "message": "输出文件名无效，跳过清理",
        }));
    }

    let result = tokio::task::spawn_blocking(move || {
        let entries = fs::read_dir(&output_dir).map_err(|error| error.to_string())?;
        let mut removed = 0usize;
        for entry in entries.filter_map(|entry| entry.ok()) {
            let entry_path = entry.path();
            if !entry_path.is_file() {
                continue;
            }
            let file_name = entry_path
                .file_name()
                .and_then(|name| name.to_str())
                .unwrap_or("");
            if file_name != keep_file_name {
                if fs::remove_file(&entry_path).is_ok() {
                    removed += 1;
                }
            }
        }
        Ok::<usize, String>(removed)
    })
    .await;

    match result {
        Ok(Ok(removed)) => HttpResponse::Ok().json(serde_json::json!({
            "message": format!("已清理 {} 个无用文件", removed),
        })),
        Ok(Err(message)) => {
            HttpResponse::InternalServerError().json(serde_json::json!({ "message": message }))
        }
        Err(error) => HttpResponse::InternalServerError()
            .json(serde_json::json!({ "message": error.to_string() })),
    }
}

async fn list_header_presets(state: web::Data<AppState>) -> impl Responder {
    let presets = state.header_presets.read().await.clone();
    HttpResponse::Ok().json(presets)
}

async fn save_header_preset(
    state: web::Data<AppState>,
    request: web::Json<HeaderPreset>,
) -> impl Responder {
    let host = request.host.trim().to_lowercase();
    let headers = normalize_headers(request.headers.clone());

    if host.is_empty() {
        return HttpResponse::BadRequest().json(serde_json::json!({
            "message": "host 不能为空",
        }));
    }

    if headers.is_empty() {
        return HttpResponse::BadRequest().json(serde_json::json!({
            "message": "至少需要一个有效 header",
        }));
    }

    let preset = HeaderPreset { host, headers };
    let persisted = {
        let mut presets = state.header_presets.write().await;
        if let Some(current) = presets.iter_mut().find(|item| item.host == preset.host) {
            *current = preset.clone();
        } else {
            presets.push(preset.clone());
        }
        presets.sort_by(|left, right| left.host.cmp(&right.host));
        presets.clone()
    };

    if let Err(error) = write_header_presets(&state.header_presets_path, &persisted) {
        return HttpResponse::InternalServerError().json(serde_json::json!({
            "message": format!("保存预设失败: {}", error),
        }));
    }

    HttpResponse::Ok().json(preset)
}

async fn delete_header_preset(
    state: web::Data<AppState>,
    host: web::Path<String>,
) -> impl Responder {
    let normalized_host = host.trim().to_lowercase();
    if normalized_host.is_empty() {
        return HttpResponse::BadRequest().json(serde_json::json!({
            "message": "host 不能为空",
        }));
    }

    let persisted = {
        let mut presets = state.header_presets.write().await;
        let previous_len = presets.len();
        presets.retain(|item| item.host != normalized_host);
        if presets.len() == previous_len {
            return HttpResponse::NotFound().json(serde_json::json!({
                "message": "预设不存在",
            }));
        }
        presets.clone()
    };

    if let Err(error) = write_header_presets(&state.header_presets_path, &persisted) {
        return HttpResponse::InternalServerError().json(serde_json::json!({
            "message": format!("删除预设失败: {}", error),
        }));
    }

    HttpResponse::NoContent().finish()
}

async fn list_transcode_presets(state: web::Data<AppState>) -> impl Responder {
    let presets = state.transcode_presets.read().await.clone();
    HttpResponse::Ok().json(presets)
}

async fn save_transcode_preset(
    state: web::Data<AppState>,
    request: web::Json<TranscodePreset>,
) -> impl Responder {
    let title = request.title.trim().to_string();
    if title.is_empty() {
        return HttpResponse::BadRequest().json(serde_json::json!({
            "message": "预设标题不能为空",
        }));
    }

    let preset = TranscodePreset {
        title,
        video_codec: request.video_codec.trim().to_string(),
        resolution: request.resolution.trim().to_string(),
        video_bitrate_kbps: request.video_bitrate_kbps.max(0),
        fps: request.fps.max(0),
        audio_codec: request.audio_codec.trim().to_string(),
        audio_bitrate_kbps: request.audio_bitrate_kbps.max(0),
        audio_channels: request.audio_channels.max(0),
        audio_sample_rate: request.audio_sample_rate.max(0),
    };

    let persisted = {
        let mut presets = state.transcode_presets.write().await;
        if let Some(current) = presets.iter_mut().find(|item| item.title == preset.title) {
            *current = preset.clone();
        } else {
            presets.push(preset.clone());
        }
        presets.sort_by(|left, right| left.title.cmp(&right.title));
        presets.clone()
    };

    if let Err(error) = write_transcode_presets(&state.transcode_presets_path, &persisted) {
        return HttpResponse::InternalServerError().json(serde_json::json!({
            "message": format!("保存转码预设失败: {}", error),
        }));
    }

    HttpResponse::Ok().json(preset)
}

async fn delete_transcode_preset(
    state: web::Data<AppState>,
    title: web::Path<String>,
) -> impl Responder {
    let normalized_title = title.trim().to_string();
    if normalized_title.is_empty() {
        return HttpResponse::BadRequest().json(serde_json::json!({
            "message": "预设标题不能为空",
        }));
    }

    let persisted = {
        let mut presets = state.transcode_presets.write().await;
        let previous_len = presets.len();
        presets.retain(|item| item.title != normalized_title);
        if presets.len() == previous_len {
            return HttpResponse::NotFound().json(serde_json::json!({
                "message": "转码预设不存在",
            }));
        }
        presets.clone()
    };

    if let Err(error) = write_transcode_presets(&state.transcode_presets_path, &persisted) {
        return HttpResponse::InternalServerError().json(serde_json::json!({
            "message": format!("删除转码预设失败: {}", error),
        }));
    }

    HttpResponse::NoContent().finish()
}

async fn execute_task(state: AppState, id: u64, payload: TaskPayload) {
    let Ok(_permit) = state.executor.clone().acquire_owned().await else {
        return;
    };

    if let Err(error) = update_task(&state, id, |task| {
        task.status = TaskStatus::Running;
        task.started_at = Some(now());
        task.message = Some("任务执行中".to_string());
    })
    .await
    {
        println!("failed to persist task {} running status: {}", id, error);
    }

    let result = match payload {
        TaskPayload::Download {
            url,
            ffmpeg_download,
            auto_clear_temp_files,
            target_file_name,
            folder,
            concurrent,
            download_dir,
            headers,
            combine_retry_count,
        } => {
            run_download_task(
                url,
                ffmpeg_download,
                auto_clear_temp_files,
                target_file_name,
                folder,
                concurrent,
                download_dir,
                headers,
                combine_retry_count,
            )
            .await
        }
        TaskPayload::Combine {
            inputs,
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
                inputs,
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
            delete_input_file,
        } => run_cut_task(input, start, duration, target_file_name, delete_input_file).await,
        TaskPayload::CutBatch {
            input,
            delete_input_file,
            segments,
        } => run_cut_batch_task(&state, id, input, delete_input_file, segments).await,
        TaskPayload::Transcode {
            input,
            target_file_name,
            video_codec,
            resolution,
            video_bitrate_kbps,
            fps,
            audio_codec,
            audio_bitrate_kbps,
            audio_channels,
            audio_sample_rate,
        } => {
            run_transcode_task(
                input,
                target_file_name,
                video_codec,
                resolution,
                video_bitrate_kbps,
                fps,
                audio_codec,
                audio_bitrate_kbps,
                audio_channels,
                audio_sample_rate,
            )
            .await
        }
    };

    if let Err(error) = update_task(&state, id, |task| {
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
    .await
    {
        println!("failed to persist task {} result: {}", id, error);
    }
}

async fn update_task<F>(state: &AppState, id: u64, updater: F) -> Result<(), String>
where
    F: FnOnce(&mut TaskRecord),
{
    let mut tasks = state.tasks.write().await;
    if let Some(task) = tasks.get_mut(&id) {
        updater(task);
    }
    write_tasks_to_config(&state.tasks_config_dir, &tasks).map_err(|error| error.to_string())
}

fn build_task_record(id: u64, title: Option<String>, payload: TaskPayload) -> TaskRecord {
    TaskRecord {
        id,
        title: title
            .filter(|value| !value.trim().is_empty())
            .unwrap_or_else(|| default_title(&payload)),
        status: TaskStatus::Queued,
        created_at: now(),
        started_at: None,
        finished_at: None,
        command_preview: build_command_preview(&payload),
        message: Some("任务已创建，等待执行".to_string()),
        result_path: None,
        parent_id: None,
        child_task_ids: Vec::new(),
        payload,
    }
}

async fn run_download_task(
    url: String,
    ffmpeg_download_mode: bool,
    auto_clear_temp_files: bool,
    target_file_name: String,
    folder: String,
    concurrent: i32,
    download_dir: String,
    headers: HashMap<String, String>,
    combine_retry_count: i32,
) -> Result<TaskOutcome, String> {
    let current_dir = env::current_dir().map_err(|error| error.to_string())?;
    ensure_directory_exists(current_dir.join(&download_dir)).map_err(|error| error.to_string())?;
    ensure_directory_exists(current_dir.join("static").join("cut"))
        .map_err(|error| error.to_string())?;

    let folder_name = resolve_download_folder_name(&url, &folder);
    let relative_folder = format!("./{}/{}", download_dir, folder_name);
    let output_name = get_file_name(target_file_name);

    if url.trim().is_empty() && !check_base_info_exists(relative_folder.clone()) {
        return Err("url or folder is required".to_string());
    }

    create_folder(relative_folder.clone()).map_err(|error| error.to_string())?;
    let persisted_base_info = BaseInfo {
        url: url.clone(),
        m3u8_name: String::new(),
        header: normalize_headers(headers.clone()),
        target_file_name: output_name.clone(),
        folder: folder_name.clone(),
        concurrent,
        download_dir: download_dir.clone(),
        ffmpeg_download: ffmpeg_download_mode,
        auto_clear_temp_files,
        combine_retry_count,
    };
    write_base_info(
        &current_dir.join(relative_folder.trim_start_matches("./")),
        &persisted_base_info,
    )
    .map_err(|error| error.to_string())?;

    let success = if ffmpeg_download_mode {
        let full_file = format!("{}/{}", relative_folder, output_name);
        ffmpeg_download(url, full_file).map_err(|_| "ffmpeg 下载失败".to_string())?
    } else {
        env::set_current_dir(Path::new(&relative_folder)).map_err(|error| error.to_string())?;
        let download_result = fast_download(
            url,
            output_name.clone(),
            folder_name.clone(),
            concurrent,
            normalize_headers(headers),
            download_dir.clone(),
            ffmpeg_download_mode,
            auto_clear_temp_files,
            combine_retry_count,
        )
        .await
        .map_err(|_| "下载失败".to_string());
        env::set_current_dir(&current_dir).map_err(|error| error.to_string())?;
        let success = download_result?;
        if success && auto_clear_temp_files {
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
    inputs: Vec<String>,
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
        let current_dir = env::current_dir().map_err(|error| error.to_string())?;
        let normalized_reg_name = resolve_to_absolute_pattern_path(&current_dir, &reg_name);
        let normalized_inputs = inputs
            .into_iter()
            .map(|value| {
                resolve_to_absolute_path(&current_dir, value.trim())
                    .display()
                    .to_string()
            })
            .collect::<Vec<_>>();
        let output_name = get_file_name(target_file_name);
        let files = if normalized_inputs.is_empty() {
            get_reg_files(normalized_reg_name.clone(), reg_name_start, reg_name_end)
                .map_err(|_| "解析文件失败".to_string())?
        } else {
            normalized_inputs
        };
        let source_dir = files
            .first()
            .and_then(|first| Path::new(first).parent())
            .or_else(|| Path::new(&normalized_reg_name).parent())
            .unwrap_or_else(|| Path::new("."))
            .to_path_buf();
        let file_name = to_files(&source_dir).map_err(|_| "生成临时文件失败".to_string())?;
        let target = if output_name.trim().is_empty() {
            source_dir.join(format!("{}.mp4", now())).display().to_string()
        } else {
            source_dir.join(&output_name).display().to_string()
        };

        let success = combine_video(
            files,
            file_name,
            target.clone(),
            source_dir,
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

        let result_path = PathBuf::from(target);

        Ok(TaskOutcome {
            message: "合并完成".to_string(),
            result_path: Some(result_path.display().to_string()),
        })
    })
    .await
    .map_err(|error| error.to_string())?
}

fn resolve_to_absolute_pattern_path(current_dir: &Path, raw: &str) -> String {
    resolve_to_absolute_path(current_dir, raw)
        .display()
        .to_string()
}

fn resolve_to_absolute_path(current_dir: &Path, raw: &str) -> PathBuf {
    let candidate = Path::new(raw);
    if candidate.is_absolute() {
        candidate.to_path_buf()
    } else {
        current_dir.join(candidate)
    }
}

async fn run_cut_task(
    input: String,
    start: u32,
    duration: u32,
    target_file_name: String,
    delete_input_file: bool,
) -> Result<TaskOutcome, String> {
    tokio::task::spawn_blocking(move || {
        if duration == 0 {
            return Err("duration 需要 > 0".to_string());
        }

        let current_dir = env::current_dir().map_err(|error| error.to_string())?;
        ensure_directory_exists(current_dir.join("static").join("cut"))
            .map_err(|error| error.to_string())?;

        let output_name = get_file_name(target_file_name);
        let target = if output_name.trim().is_empty() {
            format!("./static/cut/{}.mp4", now())
        } else {
            format!("./static/cut/{}", output_name)
        };

        let success = cut(input.clone(), start, duration, target.clone())
            .map_err(|_| "截取失败".to_string())?;
        if !success {
            return Err("截取视频失败".to_string());
        }
        if delete_input_file {
            remove_input_file(&input)?;
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

async fn run_cut_batch_task(
    state: &AppState,
    parent_id: u64,
    input: String,
    delete_input_file: bool,
    segments: Vec<CutSegment>,
) -> Result<TaskOutcome, String> {
    let child_task_ids = {
        let tasks = state.tasks.read().await;
        tasks
            .get(&parent_id)
            .map(|task| task.child_task_ids.clone())
    }
    .unwrap_or_default();

    let total = segments.len();
    let mut success_count = 0usize;
    let mut failure_messages = Vec::new();

    for (index, segment) in segments.into_iter().enumerate() {
        let child_id = child_task_ids
            .get(index)
            .copied()
            .ok_or_else(|| "子任务不存在".to_string())?;
        update_task(state, child_id, |task| {
            task.status = TaskStatus::Running;
            task.started_at = Some(now());
            task.message = Some("子任务执行中".to_string());
        })
        .await?;

        let result = run_cut_task(
            input.clone(),
            segment.start,
            segment.duration,
            segment.target_file_name,
            false,
        )
        .await;

        match result {
            Ok(outcome) => {
                success_count += 1;
                update_task(state, child_id, |task| {
                    task.status = TaskStatus::Success;
                    task.finished_at = Some(now());
                    task.message = Some(outcome.message);
                    task.result_path = outcome.result_path;
                })
                .await?;
            }
            Err(message) => {
                failure_messages.push(format!("子任务 {}: {}", index + 1, message));
                update_task(state, child_id, |task| {
                    task.status = TaskStatus::Failed;
                    task.finished_at = Some(now());
                    task.message = Some(message);
                    task.result_path = None;
                })
                .await?;
            }
        }
    }

    if !failure_messages.is_empty() {
        return Err(format!(
            "完成 {}/{} 个子任务，{}",
            success_count,
            total,
            failure_messages.join("；")
        ));
    }

    if delete_input_file {
        remove_input_file(&input)?;
    }

    Ok(TaskOutcome {
        message: format!("{} 个子任务全部完成", total),
        result_path: None,
    })
}

async fn run_transcode_task(
    input: String,
    target_file_name: String,
    video_codec: String,
    resolution: String,
    video_bitrate_kbps: i32,
    fps: i32,
    audio_codec: String,
    audio_bitrate_kbps: i32,
    audio_channels: i32,
    audio_sample_rate: i32,
) -> Result<TaskOutcome, String> {
    tokio::task::spawn_blocking(move || {
        let input_path = PathBuf::from(input.trim());
        if input_path.as_os_str().is_empty() {
            return Err("请输入需要转码的视频文件".to_string());
        }
        if !input_path.exists() {
            return Err("输入视频文件不存在".to_string());
        }

        let probe = probe_video_with_ffprobe(input_path.to_string_lossy().as_ref())?;

        let output_path = resolve_transcode_output_path(&input_path, &target_file_name);
        if let Some(parent) = output_path.parent() {
            fs::create_dir_all(parent).map_err(|error| error.to_string())?;
        }

        let mut command = Command::new("ffmpeg");
        command.arg("-y").arg("-i").arg(&input_path);

        let scale_filter = build_transcode_scale_filter(&resolution, probe.width, probe.height)?;
        let video_codec_mode = resolve_video_codec_mode(
            &video_codec,
            scale_filter.is_some(),
            video_bitrate_kbps > 0,
            fps > 0,
            probe.video_codec.as_deref(),
        );
        match video_codec_mode {
            VideoCodecMode::Copy => {
                command.arg("-c:v").arg("copy");
            }
            VideoCodecMode::Encode(encoder) => {
                command.arg("-c:v").arg(encoder);
            }
        }

        if let Some(scale_filter) = scale_filter {
            command.arg("-vf").arg(scale_filter);
        }
        if video_bitrate_kbps > 0 {
            command
                .arg("-b:v")
                .arg(format!("{}k", video_bitrate_kbps.max(1)));
        }
        if fps > 0 {
            command.arg("-r").arg(fps.to_string());
        }

        let audio_codec_mode = resolve_audio_codec_mode(
            &audio_codec,
            audio_bitrate_kbps > 0,
            audio_channels > 0,
            audio_sample_rate > 0,
            probe.audio_codec.as_deref(),
        );
        match audio_codec_mode {
            AudioCodecMode::Copy => {
                command.arg("-c:a").arg("copy");
            }
            AudioCodecMode::Encode(encoder) => {
                command.arg("-c:a").arg(encoder);
                if audio_bitrate_kbps > 0 {
                    command
                        .arg("-b:a")
                        .arg(format!("{}k", audio_bitrate_kbps.max(1)));
                }
                if audio_channels > 0 {
                    command.arg("-ac").arg(audio_channels.to_string());
                }
                if audio_sample_rate > 0 {
                    command.arg("-ar").arg(audio_sample_rate.to_string());
                }
            }
        }

        command.arg(&output_path);
        let output = command.output().map_err(|error| error.to_string())?;
        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr).to_string();
            return Err(format!("转码失败: {}", stderr));
        }

        Ok(TaskOutcome {
            message: "转码完成".to_string(),
            result_path: Some(output_path.display().to_string()),
        })
    })
    .await
    .map_err(|error| error.to_string())?
}

fn resolve_transcode_output_path(input_path: &Path, target_file_name: &str) -> PathBuf {
    let parent = input_path.parent().unwrap_or_else(|| Path::new("."));
    if !target_file_name.trim().is_empty() {
        return parent.join(ensure_video_extension(target_file_name));
    }

    let stem = input_path
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("video");
    parent.join(format!("{}_transcoded_{}.mp4", stem, now()))
}

fn ensure_video_extension(file_name: &str) -> String {
    if Path::new(file_name).extension().is_none() {
        format!("{}.mp4", file_name)
    } else {
        file_name.to_string()
    }
}

fn build_transcode_scale_filter(
    resolution: &str,
    source_width: Option<i32>,
    source_height: Option<i32>,
) -> Result<Option<String>, String> {
    let normalized = resolution.trim().to_ascii_lowercase();
    if normalized.is_empty() {
        return Ok(None);
    }

    let Some(source_width) = source_width else {
        return Err("无法读取视频分辨率，无法应用缩放".to_string());
    };
    let Some(source_height) = source_height else {
        return Err("无法读取视频分辨率，无法应用缩放".to_string());
    };

    if let Some(target_short_edge) = normalized.strip_suffix('p') {
        let short_edge = target_short_edge
            .trim()
            .parse::<i32>()
            .map_err(|_| "分辨率格式不正确，示例：1080p 或 1920x1080".to_string())?;
        if short_edge <= 0 {
            return Err("分辨率必须大于 0".to_string());
        }
        if source_width >= source_height {
            return Ok(Some(format!("scale=-2:{}", short_edge)));
        }
        return Ok(Some(format!("scale={}:-2", short_edge)));
    }

    let normalized = normalized.replace('*', "x");
    let mut parts = normalized.split('x');
    let width = parts
        .next()
        .ok_or_else(|| "分辨率格式不正确，示例：1080p 或 1920x1080".to_string())?
        .trim()
        .parse::<i32>()
        .map_err(|_| "分辨率格式不正确，示例：1080p 或 1920x1080".to_string())?;
    let height = parts
        .next()
        .ok_or_else(|| "分辨率格式不正确，示例：1080p 或 1920x1080".to_string())?
        .trim()
        .parse::<i32>()
        .map_err(|_| "分辨率格式不正确，示例：1080p 或 1920x1080".to_string())?;
    if parts.next().is_some() || width <= 0 || height <= 0 {
        return Err("分辨率格式不正确，示例：1080p 或 1920x1080".to_string());
    }

    if source_width >= source_height {
        Ok(Some(format!("scale={}:{}", width, height)))
    } else {
        Ok(Some(format!("scale={}:{}", height, width)))
    }
}

enum VideoCodecMode {
    Copy,
    Encode(String),
}

fn resolve_video_codec_mode(
    requested_codec: &str,
    scale_filter_enabled: bool,
    video_bitrate_enabled: bool,
    fps_enabled: bool,
    source_codec: Option<&str>,
) -> VideoCodecMode {
    let normalized = requested_codec.trim().to_ascii_lowercase();
    let should_encode = scale_filter_enabled || video_bitrate_enabled || fps_enabled;
    if normalized == "copy" && !should_encode {
        return VideoCodecMode::Copy;
    }
    if normalized == "h265" || normalized == "hevc" || normalized == "libx265" {
        return VideoCodecMode::Encode("libx265".to_string());
    }
    if normalized == "h264" || normalized == "avc" || normalized == "libx264" {
        return VideoCodecMode::Encode("libx264".to_string());
    }

    match source_codec.map(|value| value.to_ascii_lowercase()) {
        Some(codec) if codec.contains("265") || codec.contains("hevc") => {
            VideoCodecMode::Encode("libx265".to_string())
        }
        Some(codec) if codec.contains("264") || codec.contains("avc") => {
            VideoCodecMode::Encode("libx264".to_string())
        }
        _ if should_encode => VideoCodecMode::Encode("libx264".to_string()),
        _ => VideoCodecMode::Copy,
    }
}

enum AudioCodecMode {
    Copy,
    Encode(String),
}

fn resolve_audio_codec_mode(
    requested_codec: &str,
    audio_bitrate_enabled: bool,
    audio_channels_enabled: bool,
    audio_sample_rate_enabled: bool,
    source_codec: Option<&str>,
) -> AudioCodecMode {
    let normalized = requested_codec.trim().to_ascii_lowercase();
    let should_encode = audio_bitrate_enabled || audio_channels_enabled || audio_sample_rate_enabled;
    if normalized == "copy" && !should_encode {
        return AudioCodecMode::Copy;
    }
    if normalized == "mp3" || normalized == "libmp3lame" {
        return AudioCodecMode::Encode("libmp3lame".to_string());
    }
    if normalized == "opus" || normalized == "libopus" {
        return AudioCodecMode::Encode("libopus".to_string());
    }
    if normalized == "aac" {
        return AudioCodecMode::Encode("aac".to_string());
    }

    match source_codec.map(|value| value.to_ascii_lowercase()) {
        Some(codec) if codec.contains("aac") => AudioCodecMode::Encode("aac".to_string()),
        Some(codec) if codec.contains("mp3") => AudioCodecMode::Encode("libmp3lame".to_string()),
        Some(codec) if codec.contains("opus") => AudioCodecMode::Encode("libopus".to_string()),
        _ if should_encode => AudioCodecMode::Encode("aac".to_string()),
        _ => AudioCodecMode::Copy,
    }
}

fn ensure_directory_exists(path: PathBuf) -> std::io::Result<()> {
    if !path.exists() {
        std::fs::create_dir_all(path)?;
    }
    Ok(())
}

fn sanitize_upload_file_name(file_name: &str) -> String {
    let fallback = "uploaded.mp4".to_string();
    let name = Path::new(file_name)
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .trim();
    if name.is_empty() {
        return fallback;
    }

    let clean = name.replace(['/', '\\'], "_");
    if clean.is_empty() {
        fallback
    } else {
        clean
    }
}

fn sanitize_upload_sub_dir(sub_dir: &str) -> PathBuf {
    let mut path = PathBuf::new();
    for segment in sub_dir.split(['/', '\\']) {
        let trimmed = segment.trim();
        if trimmed.is_empty() || trimmed == "." || trimmed == ".." {
            continue;
        }
        let clean = trimmed
            .chars()
            .map(|char| match char {
                'a'..='z' | 'A'..='Z' | '0'..='9' | '-' | '_' => char,
                _ => '_',
            })
            .collect::<String>();
        if clean.is_empty() || clean == "." || clean == ".." {
            continue;
        }
        path.push(clean);
    }
    path
}

fn resolve_upload_root_dir(root_dir: &str) -> &'static str {
    if root_dir.eq_ignore_ascii_case("cut") {
        "cut"
    } else {
        "uploads"
    }
}

fn unique_upload_suffix() -> String {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    static UPLOAD_TEMP_SEQ: AtomicU64 = AtomicU64::new(0);
    let seq = UPLOAD_TEMP_SEQ.fetch_add(1, Ordering::Relaxed);
    format!("{}-{}-{}", now(), nanos, seq)
}

async fn create_upload_temp_file(upload_dir: &Path) -> std::io::Result<(File, PathBuf)> {
    for _ in 0..16 {
        let temp_path = upload_dir.join(format!("upload-{}.tmp", unique_upload_suffix()));
        match OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(&temp_path)
            .await
        {
            Ok(file) => return Ok((file, temp_path)),
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(error),
        }
    }

    Err(std::io::Error::new(
        std::io::ErrorKind::AlreadyExists,
        "failed to allocate unique upload temp file",
    ))
}

fn write_base_info(folder_path: &PathBuf, base_info: &BaseInfo) -> std::io::Result<()> {
    let content = serde_json::to_string_pretty(base_info)?;
    fs::write(folder_path.join("base_info.json"), content)
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
        TaskPayload::Cut { .. } | TaskPayload::CutBatch { .. } => "截取任务".to_string(),
        TaskPayload::Transcode { .. } => "转码任务".to_string(),
    }
}

fn build_command_preview(payload: &TaskPayload) -> String {
    match payload {
        TaskPayload::Download {
            url,
            ffmpeg_download,
            auto_clear_temp_files,
            target_file_name,
            folder,
            concurrent,
            download_dir,
            headers,
            combine_retry_count,
        } => {
            let mut parts = vec!["media-tool-rs download".to_string()];
            if !url.trim().is_empty() {
                parts.push(format!("--url={}", url));
            }
            if *ffmpeg_download {
                parts.push("--ffmpeg_download".to_string());
            }
            if !*auto_clear_temp_files {
                parts.push("--auto_clear_temp_files=false".to_string());
            }
            if !target_file_name.trim().is_empty() {
                parts.push(format!(
                    "--target_file_name={}",
                    shell_double_quote(target_file_name)
                ));
            }
            if !folder.trim().is_empty() {
                parts.push(format!("--folder={}", folder));
            }
            if *concurrent != 10 {
                parts.push(format!("--concurrent={}", concurrent));
            }
            if download_dir != "static/download" {
                parts.push(format!("--download_dir={}", download_dir));
            }
            if !headers.is_empty() {
                parts.push(format!(
                    "--header={}",
                    shell_single_quote(&serialize_headers(headers))
                ));
            }
            if *combine_retry_count != 3 {
                parts.push(format!("--combine_retry_count={}", combine_retry_count));
            }
            parts.join(" ")
        }
        TaskPayload::Combine {
            inputs,
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
            let mut parts = vec!["media-tool-rs combine".to_string()];
            if !inputs.is_empty() {
                parts.push(format!(
                    "--inputs={}",
                    shell_double_quote(&inputs.join(","))
                ));
            } else {
                parts.push(format!("-r {}", reg_name));
                parts.push(format!("--reg-file-start={}", reg_name_start));
                parts.push(format!("--reg-file-end={}", reg_name_end));
            }
            if !target_file_name.trim().is_empty() {
                parts.push(format!(
                    "--target_file_name={}",
                    shell_double_quote(target_file_name)
                ));
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
            delete_input_file,
        } => {
            let mut parts = vec![
                "media-tool-rs cut".to_string(),
                format!("-i={}", input),
                format!("-s={}", start),
                format!("-d={}", duration),
            ];
            if *delete_input_file {
                parts.push("--delete_input_file".to_string());
            }
            if !target_file_name.trim().is_empty() {
                parts.push(format!(
                    "--target_file_name={}",
                    shell_double_quote(target_file_name)
                ));
            }
            parts.join(" ")
        }
        TaskPayload::CutBatch {
            input,
            delete_input_file,
            segments,
        } => {
            let mut parts = vec![
                "media-tool-rs cut-batch".to_string(),
                format!("-i={}", input),
                format!("--segments={}", segments.len()),
            ];
            if *delete_input_file {
                parts.push("--delete_input_file".to_string());
            }
            parts.join(" ")
        }
        TaskPayload::Transcode {
            input,
            target_file_name,
            video_codec,
            resolution,
            video_bitrate_kbps,
            fps,
            audio_codec,
            audio_bitrate_kbps,
            audio_channels,
            audio_sample_rate,
        } => {
            let mut parts = vec![
                "media-tool-rs transcode".to_string(),
                format!("-i={}", shell_double_quote(input)),
            ];
            if !target_file_name.trim().is_empty() {
                parts.push(format!(
                    "--target_file_name={}",
                    shell_double_quote(target_file_name)
                ));
            }
            if !video_codec.trim().is_empty() {
                parts.push(format!("--video_codec={}", video_codec));
            }
            if !resolution.trim().is_empty() {
                parts.push(format!("--resolution={}", resolution));
            }
            if *video_bitrate_kbps > 0 {
                parts.push(format!("--video_bitrate_kbps={}", video_bitrate_kbps));
            }
            if *fps > 0 {
                parts.push(format!("--fps={}", fps));
            }
            if !audio_codec.trim().is_empty() {
                parts.push(format!("--audio_codec={}", audio_codec));
            }
            if *audio_bitrate_kbps > 0 {
                parts.push(format!("--audio_bitrate_kbps={}", audio_bitrate_kbps));
            }
            if *audio_channels > 0 {
                parts.push(format!("--audio_channels={}", audio_channels));
            }
            if *audio_sample_rate > 0 {
                parts.push(format!("--audio_sample_rate={}", audio_sample_rate));
            }
            parts.join(" ")
        }
    }
}

fn resolve_task_output_detail(task: &TaskRecord) -> (Option<String>, Vec<String>) {
    let current_dir = env::current_dir().ok();
    let output_dir = match &task.payload {
        TaskPayload::Download {
            folder,
            download_dir,
            url,
            ..
        } => current_dir.clone().map(|base| {
            let folder_name = resolve_download_folder_name(url, folder);
            base.join(download_dir).join(folder_name)
        }),
        TaskPayload::Combine { .. } => task
            .result_path
            .as_ref()
            .and_then(|value| Path::new(value).parent().map(|parent| parent.to_path_buf()))
            .or(current_dir.clone()),
        TaskPayload::Cut { .. } | TaskPayload::CutBatch { .. } => {
            current_dir.map(|base| base.join("static").join("cut"))
        }
        TaskPayload::Transcode { .. } => task
            .result_path
            .as_ref()
            .and_then(|value| Path::new(value).parent().map(|parent| parent.to_path_buf()))
            .or(current_dir.clone()),
    };

    let files = output_dir
        .as_ref()
        .map(read_directory_entries)
        .unwrap_or_default();

    (output_dir.map(|path| path.display().to_string()), files)
}

fn read_directory_entries(path: &PathBuf) -> Vec<String> {
    if !path.exists() {
        return Vec::new();
    }

    let mut names = fs::read_dir(path)
        .ok()
        .into_iter()
        .flatten()
        .filter_map(|entry| entry.ok())
        .map(|entry| entry.path())
        .filter_map(|path| {
            path.file_name()
                .map(|name| name.to_string_lossy().to_string())
        })
        .collect::<Vec<_>>();
    names.sort();
    names
}

fn build_cut_child_tasks(
    parent_id: u64,
    input: String,
    _delete_input_file: bool,
    segments: &[CutSegment],
    state: &web::Data<AppState>,
) -> Vec<TaskRecord> {
    segments
        .iter()
        .enumerate()
        .map(|(index, segment)| {
            let child_id = state.next_id.fetch_add(1, Ordering::SeqCst);
            let mut task = build_task_record(
                child_id,
                Some(build_cut_child_title(index, segment)),
                TaskPayload::Cut {
                    input: input.clone(),
                    start: segment.start,
                    duration: segment.duration,
                    target_file_name: segment.target_file_name.clone(),
                    delete_input_file: false,
                },
            );
            task.parent_id = Some(parent_id);
            task.message = Some("等待父任务调度".to_string());
            task
        })
        .collect()
}

fn build_cut_child_title(index: usize, segment: &CutSegment) -> String {
    if !segment.target_file_name.trim().is_empty() {
        return segment.target_file_name.clone();
    }
    format!(
        "片段 {}（{}s-{}s）",
        index + 1,
        segment.start,
        segment.start + segment.duration
    )
}

fn load_download_tasks(download_root: PathBuf) -> HashMap<u64, TaskRecord> {
    let mut tasks = HashMap::new();
    let mut next_id = 1;
    let mut folders = fs::read_dir(download_root)
        .ok()
        .into_iter()
        .flatten()
        .filter_map(|entry| entry.ok())
        .map(|entry| entry.path())
        .filter(|path| path.is_dir())
        .collect::<Vec<_>>();

    folders.sort();

    for folder_path in folders {
        let Some(folder_name) = folder_path
            .file_name()
            .map(|name| name.to_string_lossy().to_string())
        else {
            continue;
        };

        let base_info = read_task_base_info(&folder_path).unwrap_or_else(|| BaseInfo {
            url: String::new(),
            m3u8_name: String::new(),
            header: HashMap::new(),
            target_file_name: String::new(),
            folder: folder_name.clone(),
            concurrent: 10,
            download_dir: "static/download".to_string(),
            ffmpeg_download: false,
            auto_clear_temp_files: true,
            combine_retry_count: 3,
        });
        let result_path = detect_result_video(&folder_path);
        let timestamp = folder_path
            .metadata()
            .ok()
            .and_then(|metadata| metadata.modified().ok())
            .and_then(|value| value.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|value| value.as_secs())
            .unwrap_or_else(now);
        let payload = TaskPayload::Download {
            url: base_info.url.clone(),
            ffmpeg_download: base_info.ffmpeg_download,
            auto_clear_temp_files: base_info.auto_clear_temp_files,
            target_file_name: if !base_info.target_file_name.trim().is_empty() {
                base_info.target_file_name.clone()
            } else {
                result_path
                    .as_ref()
                    .and_then(|value| {
                        Path::new(value)
                            .file_name()
                            .map(|name| name.to_string_lossy().to_string())
                    })
                    .unwrap_or_default()
            },
            folder: folder_name.clone(),
            concurrent: if base_info.concurrent > 0 {
                base_info.concurrent
            } else {
                10
            },
            download_dir: if base_info.download_dir.trim().is_empty() {
                "static/download".to_string()
            } else {
                base_info.download_dir.clone()
            },
            headers: normalize_headers(base_info.header),
            combine_retry_count: if base_info.combine_retry_count > 0 {
                base_info.combine_retry_count
            } else {
                3
            },
        };
        let status = if result_path.is_some() {
            TaskStatus::Success
        } else {
            TaskStatus::Failed
        };
        let title = result_path
            .as_ref()
            .and_then(|value| {
                Path::new(value)
                    .file_name()
                    .map(|name| name.to_string_lossy().to_string())
            })
            .unwrap_or_else(|| format!("下载任务 {}", folder_name));

        tasks.insert(
            next_id,
            TaskRecord {
                id: next_id,
                title,
                status,
                created_at: timestamp,
                started_at: Some(timestamp),
                finished_at: Some(timestamp),
                command_preview: build_command_preview(&payload),
                message: Some(if result_path.is_some() {
                    "下载完成".to_string()
                } else {
                    "任务未完成，可重试".to_string()
                }),
                result_path,
                parent_id: None,
                child_task_ids: Vec::new(),
                payload,
            },
        );
        next_id += 1;
    }
    tasks
}

fn task_kind_from_payload(payload: &TaskPayload) -> TaskKind {
    match payload {
        TaskPayload::Download { .. } => TaskKind::Download,
        TaskPayload::Combine { .. } => TaskKind::Combine,
        TaskPayload::Cut { .. } | TaskPayload::CutBatch { .. } => TaskKind::Cut,
        TaskPayload::Transcode { .. } => TaskKind::Transcode,
    }
}

fn ensure_task_files(task_config_dir: &PathBuf) -> std::io::Result<()> {
    fs::create_dir_all(task_config_dir)?;
    for kind in [
        TaskKind::Download,
        TaskKind::Combine,
        TaskKind::Cut,
        TaskKind::Transcode,
    ] {
        let file_path = task_config_dir.join(kind.file_name());
        if !file_path.exists() {
            fs::write(file_path, "[]")?;
        }
    }
    Ok(())
}

fn load_tasks_from_config(task_config_dir: &PathBuf) -> HashMap<u64, TaskRecord> {
    let mut tasks = HashMap::new();
    for kind in [
        TaskKind::Download,
        TaskKind::Combine,
        TaskKind::Cut,
        TaskKind::Transcode,
    ] {
        let file_path = task_config_dir.join(kind.file_name());
        let records = fs::read_to_string(file_path)
            .ok()
            .and_then(|content| serde_json::from_str::<Vec<TaskRecord>>(&content).ok())
            .unwrap_or_default();
        for record in records {
            tasks.insert(record.id, record);
        }
    }
    tasks
}

fn write_tasks_to_config(
    task_config_dir: &PathBuf,
    tasks: &HashMap<u64, TaskRecord>,
) -> std::io::Result<()> {
    ensure_task_files(task_config_dir)?;
    let mut download = Vec::new();
    let mut combine = Vec::new();
    let mut cut = Vec::new();
    let mut transcode = Vec::new();
    for task in tasks.values().cloned() {
        match task_kind_from_payload(&task.payload) {
            TaskKind::Download => download.push(task),
            TaskKind::Combine => combine.push(task),
            TaskKind::Cut => cut.push(task),
            TaskKind::Transcode => transcode.push(task),
        }
    }
    for records in [&mut download, &mut combine, &mut cut, &mut transcode] {
        records.sort_by(|left, right| right.id.cmp(&left.id));
    }
    fs::write(
        task_config_dir.join(TaskKind::Download.file_name()),
        serde_json::to_string_pretty(&download)?,
    )?;
    fs::write(
        task_config_dir.join(TaskKind::Combine.file_name()),
        serde_json::to_string_pretty(&combine)?,
    )?;
    fs::write(
        task_config_dir.join(TaskKind::Cut.file_name()),
        serde_json::to_string_pretty(&cut)?,
    )?;
    fs::write(
        task_config_dir.join(TaskKind::Transcode.file_name()),
        serde_json::to_string_pretty(&transcode)?,
    )?;
    Ok(())
}

async fn persist_tasks(state: &web::Data<AppState>) -> Result<(), String> {
    let tasks = state.tasks.read().await;
    write_tasks_to_config(&state.tasks_config_dir, &tasks).map_err(|error| error.to_string())
}

fn cleanup_task_artifacts(task: &TaskRecord) -> std::io::Result<()> {
    if let Some(target_dir) = resolve_task_directory(task) {
        if target_dir.exists() {
            fs::remove_dir_all(target_dir)?;
        }
        return Ok(());
    }

    if let Some(result_path) = &task.result_path {
        let path = PathBuf::from(result_path);
        if path.exists() && path.is_file() {
            fs::remove_file(path)?;
        }
    }
    Ok(())
}

fn read_task_base_info(folder_path: &PathBuf) -> Option<BaseInfo> {
    let base_info_path = folder_path.join("base_info.json");
    let content = fs::read_to_string(base_info_path).ok()?;
    serde_json::from_str(&content).ok()
}

fn detect_result_video(folder_path: &PathBuf) -> Option<String> {
    const VIDEO_EXTENSIONS: [&str; 6] = ["mp4", "mkv", "mov", "avi", "webm", "m4v"];

    let mut files = fs::read_dir(folder_path)
        .ok()?
        .filter_map(|entry| entry.ok())
        .map(|entry| entry.path())
        .filter(|path| path.is_file())
        .filter(|path| {
            path.extension()
                .and_then(|extension| extension.to_str())
                .map(|extension| VIDEO_EXTENSIONS.contains(&extension.to_lowercase().as_str()))
                .unwrap_or(false)
        })
        .collect::<Vec<_>>();
    files.sort();
    files.last().map(|path| path.display().to_string())
}

fn remove_input_file(input: &str) -> Result<(), String> {
    let path = PathBuf::from(input);
    if !path.exists() {
        return Ok(());
    }
    fs::remove_file(&path).map_err(|error| format!("删除输入文件失败: {}", error))
}

fn resolve_task_directory(task: &TaskRecord) -> Option<PathBuf> {
    match &task.payload {
        TaskPayload::Download {
            folder,
            download_dir,
            url,
            ..
        } => env::current_dir().ok().map(|base| {
            base.join(download_dir)
                .join(resolve_download_folder_name(url, folder))
        }),
        _ => None,
    }
}

fn hydrate_retry_payload(payload: TaskPayload, task_dir: Option<PathBuf>) -> TaskPayload {
    match payload {
        TaskPayload::Download {
            folder,
            download_dir,
            url,
            ffmpeg_download,
            auto_clear_temp_files,
            target_file_name,
            concurrent,
            headers,
            combine_retry_count,
        } => {
            let base_info = task_dir.and_then(|path| read_task_base_info(&path));
            if let Some(info) = base_info {
                TaskPayload::Download {
                    url: if info.url.trim().is_empty() {
                        url
                    } else {
                        info.url
                    },
                    ffmpeg_download: info.ffmpeg_download || ffmpeg_download,
                    auto_clear_temp_files: info.auto_clear_temp_files,
                    target_file_name: if info.target_file_name.trim().is_empty() {
                        target_file_name
                    } else {
                        info.target_file_name
                    },
                    folder,
                    concurrent: if info.concurrent > 0 {
                        info.concurrent
                    } else {
                        concurrent
                    },
                    download_dir: if info.download_dir.trim().is_empty() {
                        download_dir
                    } else {
                        info.download_dir
                    },
                    headers: if info.header.is_empty() {
                        headers
                    } else {
                        normalize_headers(info.header)
                    },
                    combine_retry_count: if info.combine_retry_count > 0 {
                        info.combine_retry_count
                    } else {
                        combine_retry_count
                    },
                }
            } else {
                TaskPayload::Download {
                    url,
                    ffmpeg_download,
                    auto_clear_temp_files,
                    target_file_name,
                    folder,
                    concurrent,
                    download_dir,
                    headers,
                    combine_retry_count,
                }
            }
        }
        other => other,
    }
}

fn probe_video_with_ffprobe(input: &str) -> Result<VideoProbeResponse, String> {
    let output = Command::new("ffprobe")
        .args([
            "-v",
            "error",
            "-print_format",
            "json",
            "-show_format",
            "-show_streams",
        ])
        .arg(input)
        .output()
        .map_err(|error| format!("执行 ffprobe 失败: {}", error))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).to_string();
        return Err(if stderr.trim().is_empty() {
            "ffprobe 分析失败".to_string()
        } else {
            stderr
        });
    }

    let value: serde_json::Value =
        serde_json::from_slice(&output.stdout).map_err(|error| format!("解析 ffprobe 输出失败: {}", error))?;
    let format = value
        .get("format")
        .and_then(|node| node.as_object())
        .cloned()
        .unwrap_or_default();
    let streams = value
        .get("streams")
        .and_then(|node| node.as_array())
        .cloned()
        .unwrap_or_default();

    let video_stream = streams.iter().find(|stream| {
        stream
            .get("codec_type")
            .and_then(|value| value.as_str())
            .unwrap_or_default()
            == "video"
    });
    let audio_stream = streams.iter().find(|stream| {
        stream
            .get("codec_type")
            .and_then(|value| value.as_str())
            .unwrap_or_default()
            == "audio"
    });

    Ok(VideoProbeResponse {
        format_name: format
            .get("format_name")
            .and_then(|value| value.as_str())
            .unwrap_or_default()
            .to_string(),
        duration_seconds: parse_ffprobe_f64(format.get("duration")),
        size_bytes: parse_ffprobe_u64(format.get("size")),
        overall_bitrate: parse_ffprobe_u64(format.get("bit_rate")),
        video_codec: video_stream
            .and_then(|stream| stream.get("codec_name"))
            .and_then(|value| value.as_str())
            .map(|value| value.to_string()),
        width: video_stream
            .and_then(|stream| stream.get("width"))
            .and_then(|value| value.as_i64())
            .map(|value| value as i32),
        height: video_stream
            .and_then(|stream| stream.get("height"))
            .and_then(|value| value.as_i64())
            .map(|value| value as i32),
        fps: video_stream
            .and_then(|stream| stream.get("avg_frame_rate"))
            .and_then(|value| value.as_str())
            .and_then(parse_ffprobe_ratio),
        video_bitrate: video_stream
            .and_then(|stream| stream.get("bit_rate"))
            .and_then(|value| parse_ffprobe_u64(Some(value))),
        audio_codec: audio_stream
            .and_then(|stream| stream.get("codec_name"))
            .and_then(|value| value.as_str())
            .map(|value| value.to_string()),
        audio_channels: audio_stream
            .and_then(|stream| stream.get("channels"))
            .and_then(|value| value.as_i64())
            .map(|value| value as i32),
        audio_sample_rate: audio_stream
            .and_then(|stream| stream.get("sample_rate"))
            .and_then(|value| value.as_str())
            .and_then(|value| value.parse::<i32>().ok()),
        audio_bitrate: audio_stream
            .and_then(|stream| stream.get("bit_rate"))
            .and_then(|value| parse_ffprobe_u64(Some(value))),
    })
}

fn parse_ffprobe_ratio(value: &str) -> Option<f64> {
    let mut parts = value.split('/');
    let numerator = parts.next()?.trim().parse::<f64>().ok()?;
    let denominator = parts.next()?.trim().parse::<f64>().ok()?;
    if parts.next().is_some() || denominator <= 0.0 {
        return None;
    }
    Some(numerator / denominator)
}

fn parse_ffprobe_f64(value: Option<&serde_json::Value>) -> Option<f64> {
    value.and_then(|node| match node {
        serde_json::Value::Number(number) => number.as_f64(),
        serde_json::Value::String(text) => text.parse::<f64>().ok(),
        _ => None,
    })
}

fn parse_ffprobe_u64(value: Option<&serde_json::Value>) -> Option<u64> {
    value.and_then(|node| match node {
        serde_json::Value::Number(number) => number.as_u64(),
        serde_json::Value::String(text) => text.parse::<u64>().ok(),
        _ => None,
    })
}

fn default_header_presets() -> Vec<HeaderPreset> {
    vec![]
}

fn default_transcode_presets() -> Vec<TranscodePreset> {
    vec![]
}

fn ensure_header_presets_file(path: &PathBuf) -> std::io::Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    if path.exists() {
        return Ok(());
    }
    let defaults = default_header_presets();
    write_header_presets(path, &defaults)
}

fn load_header_presets(path: &PathBuf) -> Vec<HeaderPreset> {
    let presets = fs::read_to_string(path)
        .ok()
        .and_then(|content| serde_json::from_str::<Vec<HeaderPreset>>(&content).ok())
        .unwrap_or_default();
    merge_header_presets(default_header_presets(), presets)
}

fn ensure_transcode_presets_file(path: &PathBuf) -> std::io::Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    if path.exists() {
        return Ok(());
    }
    write_transcode_presets(path, &default_transcode_presets())
}

fn load_transcode_presets(path: &PathBuf) -> Vec<TranscodePreset> {
    let mut presets = fs::read_to_string(path)
        .ok()
        .and_then(|content| serde_json::from_str::<Vec<TranscodePreset>>(&content).ok())
        .unwrap_or_else(default_transcode_presets);
    presets.sort_by(|left, right| left.title.cmp(&right.title));
    presets
}

fn merge_header_presets(
    defaults: Vec<HeaderPreset>,
    stored: Vec<HeaderPreset>,
) -> Vec<HeaderPreset> {
    let mut merged = defaults;
    for preset in stored {
        let normalized = HeaderPreset {
            host: preset.host.trim().to_lowercase(),
            headers: normalize_headers(preset.headers),
        };
        if normalized.host.is_empty() || normalized.headers.is_empty() {
            continue;
        }
        if let Some(current) = merged.iter_mut().find(|item| item.host == normalized.host) {
            *current = normalized;
        } else {
            merged.push(normalized);
        }
    }
    merged.sort_by(|left, right| left.host.cmp(&right.host));
    merged
}

fn write_header_presets(path: &PathBuf, presets: &[HeaderPreset]) -> std::io::Result<()> {
    let content = serde_json::to_string_pretty(presets)?;
    fs::write(path, content)
}

fn write_transcode_presets(path: &PathBuf, presets: &[TranscodePreset]) -> std::io::Result<()> {
    let content = serde_json::to_string_pretty(presets)?;
    fs::write(path, content)
}

fn serialize_headers(headers: &HashMap<String, String>) -> String {
    serde_json::to_string(headers).unwrap_or_else(|_| "{}".to_string())
}

fn shell_single_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\"'\"'"))
}

fn shell_double_quote(value: &str) -> String {
    format!("\"{}\"", value.replace('\\', "\\\\").replace('"', "\\\""))
}

fn normalize_headers(headers: HashMap<String, String>) -> HashMap<String, String> {
    headers
        .into_iter()
        .filter_map(|(key, value)| {
            let normalized_key = key.trim().to_string();
            let normalized_value = value.trim().to_string();
            if normalized_key.is_empty() || normalized_value.is_empty() {
                None
            } else {
                Some((normalized_key, normalized_value))
            }
        })
        .collect()
}
