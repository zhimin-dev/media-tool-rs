use crate::cmd::cmd::{check_base_info_exists, clear_temp_files, cut, download as ffmpeg_download};
use crate::combine::parse::{combine_video, get_reg_file_name, get_reg_files, to_files};
use crate::common::now;
use crate::download::download::{create_folder, fast_download, get_file_name};
use crate::download::BaseInfo;
use actix_web::{web, App, HttpResponse, HttpServer, Responder, HttpRequest};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::env;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
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

#[derive(Debug, Serialize)]
pub struct TaskDetailResponse {
    pub task: TaskRecord,
    pub output_dir: Option<String>,
    pub output_files: Vec<String>,
    pub base_info: Option<BaseInfo>,
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
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HeaderPreset {
    pub host: String,
    #[serde(default)]
    pub headers: HashMap<String, String>,
}

#[derive(Clone)]
struct AppState {
    tasks: Arc<RwLock<HashMap<u64, TaskRecord>>>,
    next_id: Arc<AtomicU64>,
    executor: Arc<Semaphore>,
    header_presets: Arc<RwLock<Vec<HeaderPreset>>>,
    header_presets_path: Arc<PathBuf>,
}

impl AppState {
    fn new() -> Self {
        let current_dir = env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
        let tasks = load_download_tasks(current_dir.join("download"));
        let next_id = tasks.keys().copied().max().unwrap_or(0) + 1;
        let header_presets_path = current_dir.join("header_presets.json");
        Self {
            tasks: Arc::new(RwLock::new(tasks)),
            next_id: Arc::new(AtomicU64::new(next_id)),
            executor: Arc::new(Semaphore::new(1)),
            header_presets: Arc::new(RwLock::new(load_header_presets(&header_presets_path))),
            header_presets_path: Arc::new(header_presets_path),
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
            .route("/api/tasks/{id}/detail", web::get().to(get_task_detail))
            .route("/api/tasks/{id}/retry", web::post().to(retry_task))
            .route("/api/tasks/{id}/base-info", web::put().to(update_task_base_info))
            .route("/api/tasks/{id}", web::delete().to(delete_task))
            .route("/api/header-presets", web::get().to(list_header_presets))
            .route("/api/header-presets", web::post().to(save_header_preset))
            .route("/api/header-presets/{host}", web::delete().to(delete_header_preset))
            .route("/api/serve-video", web::get().to(serve_video))
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

#[derive(Deserialize)]
struct ServeVideoQuery {
    path: String,
}

async fn serve_video(query: web::Query<ServeVideoQuery>, req: HttpRequest) -> HttpResponse {
    let requested_path = PathBuf::from(&query.path);

    let Ok(canonical) = requested_path.canonicalize() else {
        return HttpResponse::NotFound().body("file not found");
    };

    if !canonical.is_file() {
        return HttpResponse::NotFound().body("not a file");
    }

    let extension = canonical
        .extension()
        .and_then(|ext| ext.to_str())
        .unwrap_or("")
        .to_lowercase();

    const ALLOWED_EXTENSIONS: [&str; 6] = ["mp4", "mkv", "mov", "avi", "webm", "m4v"];
    if !ALLOWED_EXTENSIONS.contains(&extension.as_str()) {
        return HttpResponse::Forbidden().body("unsupported file type");
    }

    match actix_files::NamedFile::open(&canonical) {
        Ok(file) => file.into_response(&req),
        Err(_) => HttpResponse::InternalServerError().body("failed to read file"),
    }
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
    let id = state.next_id.fetch_add(1, Ordering::SeqCst);
    let task = build_task_record(id, request.title.clone(), request.payload.clone());
    let payload = task.payload.clone();

    state.tasks.write().await.insert(id, task.clone());

    let background_state = state.get_ref().clone();
    tokio::spawn(async move {
        execute_task(background_state, id, payload).await;
    });

    HttpResponse::Ok().json(task)
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

    let (output_dir, output_files) = resolve_task_output_detail(&task);
    let base_info = resolve_task_directory(&task).and_then(|path| read_task_base_info(&path));
    HttpResponse::Ok().json(TaskDetailResponse {
        task,
        output_dir,
        output_files,
        base_info,
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

    let id = state.next_id.fetch_add(1, Ordering::SeqCst);
    let retry_dir = resolve_task_directory(&source_task);
    let payload = hydrate_retry_payload(source_task.payload, retry_dir);
    let task = build_task_record(
        id,
        Some(format!("{}（重试）", source_task.title)),
        payload,
    );
    let payload = task.payload.clone();
    state.tasks.write().await.insert(id, task.clone());

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

    update_task(&state, id, |record| {
        record.payload = TaskPayload::Download {
            url: base_info.url.clone(),
            ffmpeg_download: base_info.ffmpeg_download,
            target_file_name: base_info.target_file_name.clone(),
            folder: base_info.folder.clone(),
            concurrent: base_info.concurrent,
            download_dir: base_info.download_dir.clone(),
            headers: base_info.header.clone(),
        };
        record.command_preview = build_command_preview(&record.payload);
        record.message = Some("base_info.json 已更新，可重试".to_string());
    })
    .await;

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

    if let Some(target_dir) = resolve_task_directory(&task) {
        if target_dir.exists() {
            if let Err(error) = fs::remove_dir_all(&target_dir) {
                return HttpResponse::InternalServerError().json(serde_json::json!({
                    "message": format!("删除任务目录失败: {}", error),
                }));
            }
        }
    }

    state.tasks.write().await.remove(&id);
    HttpResponse::Ok().json(task)
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
        payload,
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
    let persisted_base_info = BaseInfo {
        url: url.clone(),
        m3u8_name: String::new(),
        header: normalize_headers(headers.clone()),
        target_file_name: output_name.clone(),
        folder: folder_name.clone(),
        concurrent,
        download_dir: download_dir.clone(),
        ffmpeg_download: ffmpeg_download_mode,
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
        )
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
        TaskPayload::Cut { .. } => "截取任务".to_string(),
    }
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
            if download_dir != "download" {
                parts.push(format!("--download_dir={}", download_dir));
            }
            if !headers.is_empty() {
                parts.push(format!(
                    "--header={}",
                    shell_single_quote(&serialize_headers(headers))
                ));
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
        } => {
            let mut parts = vec![
                "media-tool-rs cut".to_string(),
                format!("-i={}", input),
                format!("-s={}", start),
                format!("-d={}", duration),
            ];
            if !target_file_name.trim().is_empty() {
                parts.push(format!(
                    "--target_file_name={}",
                    shell_double_quote(target_file_name)
                ));
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
        TaskPayload::Cut { .. } => current_dir.map(|base| base.join("cut")),
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
            download_dir: "download".to_string(),
            ffmpeg_download: false,
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
                "download".to_string()
            } else {
                base_info.download_dir.clone()
            },
            headers: normalize_headers(base_info.header),
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
                payload,
            },
        );
        next_id += 1;
    }

    tasks
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
            target_file_name,
            concurrent,
            headers,
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
                }
            } else {
                TaskPayload::Download {
                    url,
                    ffmpeg_download,
                    target_file_name,
                    folder,
                    concurrent,
                    download_dir,
                    headers,
                }
            }
        }
        other => other,
    }
}

fn default_header_presets() -> Vec<HeaderPreset> {
    vec![HeaderPreset {
        host: "surrit.com".to_string(),
        headers: HashMap::from([("origin".to_string(), "https://missav.live".to_string())]),
    }]
}

fn load_header_presets(path: &PathBuf) -> Vec<HeaderPreset> {
    let presets = fs::read_to_string(path)
        .ok()
        .and_then(|content| serde_json::from_str::<Vec<HeaderPreset>>(&content).ok())
        .unwrap_or_default();
    merge_header_presets(default_header_presets(), presets)
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
