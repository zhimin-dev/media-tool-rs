#[path = "../../../src/api.rs"]
mod api;
#[path = "../../../src/cmd.rs"]
mod cmd;
#[path = "../../../src/combine.rs"]
mod combine;
#[path = "../../../src/common.rs"]
mod common;
#[path = "../../../src/download.rs"]
mod download;
#[path = "../../../src/m3u8.rs"]
mod m3u8;
#[path = "../../../src/repeat/mod.rs"]
mod repeat;

use std::env;
use std::fs;
use std::path::PathBuf;
use tauri::Manager;

#[tauri::command]
fn api_base() -> Result<String, String> {
  read_api_base_from_runtime_file().ok_or_else(|| "embedded api is not ready".to_string())
}

fn read_api_base_from_runtime_file() -> Option<String> {
  let current_dir = env::current_dir().ok()?;
  let runtime_file = current_dir
    .join("config")
    .join("runtime")
    .join("server-info.json");
  let raw = fs::read_to_string(runtime_file).ok()?;
  let value = serde_json::from_str::<serde_json::Value>(&raw).ok()?;
  value
    .get("api_base")
    .and_then(|item| item.as_str())
    .map(|item| item.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .setup(|app| {
      let app_data_dir: PathBuf = app
        .path()
        .app_local_data_dir()
        .map_err(|error| error.to_string())?;
      fs::create_dir_all(&app_data_dir).map_err(|error| error.to_string())?;
      env::set_current_dir(&app_data_dir).map_err(|error| error.to_string())?;

      std::thread::spawn(|| {
        let system = actix_web::rt::System::new();
        let result = system.block_on(async {
          api::run_server(0).await
        });
        if let Err(error) = result {
          eprintln!("failed to start embedded api server: {}", error);
        }
      });

      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      Ok(())
    })
    .invoke_handler(tauri::generate_handler![api_base])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
