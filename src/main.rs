extern crate core;

mod api;
mod cmd;
mod combine;
mod common;
mod download;
mod m3u8;
mod repeat;
use crate::cmd::cmd::{check_base_info_exists, clear_temp_files, cut, download};
use crate::combine::parse::{combine_video, get_reg_file_name, get_reg_files, to_files};
use crate::common::now;
use crate::download::download::{create_folder, fast_download, get_file_name};
use clap::{Args as clapArgs, Parser, Subcommand};
use md5;
use std::collections::HashMap;
use std::env;
use std::path::{Path, PathBuf};
use url::Url;

#[derive(Parser)]
#[command(name = "ffmpeg-tool-rs")]
#[command(
    author = "zmisgod", version = env ! ("CARGO_PKG_VERSION"), about = "", long_about = None,
)]
pub struct Args {
    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand)]
enum Commands {
    /// 合并视频
    Combine(CombineArgs),
    /// 下载视频
    Download(DownloadArgs),
    /// 截取视频
    Cut(CutArgs),
    /// 启动可视化任务接口
    Serve(ServeArgs),
}

#[derive(clapArgs)]
pub struct CutArgs {
    /// 需要截取的视频
    #[arg(short = 'i', long = "input")]
    input: String,

    /// 视频开始的秒数
    #[arg(short = 's', long = "start", default_value_t = 0)]
    start: u32,

    /// 截取视频的时长
    #[arg(short = 'd', long = "duration", default_value_t = 3)]
    duration: u32,

    /// 输出的文件名
    #[arg(long = "target_file_name", default_value_t = String::from(""))]
    target_file_name: String,
}

impl CutArgs {
    pub fn check(&mut self) -> i32 {
        if self.duration <= 0 {
            println!("duration 需要 > 0");
            return 1;
        }
        0
    }

    pub fn get_folder(&self) -> &str {
        "static/cut"
    }

    fn get_target(&self) -> String {
        let target;
        let folder = self.get_folder();
        if self.target_file_name.is_empty() {
            target = format!("./{}/{}.mp4", folder, now());
        } else {
            target = format!("./{}/{}", folder, self.target_file_name);
        }
        target
    }
    pub fn cut(&mut self) {
        let status = self.check();
        if status == 1 {
            return;
        }
        let target = self.get_target();
        let res = cut(
            self.input.clone(),
            self.start,
            self.duration,
            target.clone(),
        )
        .expect("处理失败");
        if res {
            println!("截取视频成功")
        } else {
            println!("截取视频失败")
        }
    }
}

#[derive(clapArgs)]
pub struct CombineArgs {
    /// 正则模式， 输入文件 https://zmis.me/video(.*).mp4
    #[arg(short = 'r', long = "reg-name", default_value_t = String::from(""))]
    reg_name: String,

    /// 正则模式，输入的文件开始数字
    #[arg(long = "reg-file-start")]
    reg_name_start: i32,

    /// 正则模式，输入的文件结束数字
    #[arg(long = "reg-file-end")]
    reg_name_end: i32,

    /// 输出的文件名
    #[arg(long = "target_file_name", default_value_t = String::from(""))]
    target_file_name: String,

    /// 相同视频参数，如果指定，则根据指定视频的视频码率、音频码率、fps进行合并, 则后面set开头的参数均被覆盖, 从0开始
    #[arg(long = "same_param_index", default_value_t = - 1)]
    same_param_index: i32,

    /// 指定fps
    #[arg(long = "set_fps", default_value_t = 0)]
    set_fps: i32,

    /// 指定音频码率, audio bitrate,单位：k
    #[arg(long = "set_a_b", default_value_t = 0)]
    set_a_b: i32,

    /// 指定视频码率, video bitrate，单位：k
    #[arg(long = "set_v_b", default_value_t = 0)]
    set_v_b: i32,

    /// 指定视频高度，单位：k
    #[arg(long = "set_height", default_value_t = 0)]
    set_height: i32,

    /// 指定视频宽度，单位：k
    #[arg(long = "set_width", default_value_t = 0)]
    set_width: i32,
}

impl CombineArgs {
    fn get_target_folder(&self) -> String {
        let target;
        if self.target_file_name.is_empty() {
            target = format!("./{}", get_reg_file_name(self.reg_name.to_owned()));
        } else {
            target = format!("./{}", self.target_file_name);
        }

        target
    }
    pub fn combine(&self) {
        let files = get_reg_files(
            self.reg_name.clone(),
            self.reg_name_start,
            self.reg_name_end,
        )
        .expect("解析失败");
        let file_name = to_files().expect("生成文件失败");
        let target = self.get_target_folder();
        let res = combine_video(
            files,
            file_name.clone(),
            target,
            self.same_param_index,
            self.set_a_b,
            self.set_v_b,
            self.set_fps,
            self.set_width,
            self.set_height,
        )
        .expect("合并文件失败");
        if res {
            println!("合并文件成功")
        } else {
            println!("合并文件失败")
        }
    }
}

#[derive(clapArgs)]
pub struct DownloadArgs {
    /// m3u8链接地址
    #[arg(long = "url", default_value_t = String::from(""))]
    url: String,

    /// 使用ffmpeg下载
    #[arg(long = "ffmpeg_download")]
    ffmpeg_download: bool,

    /// 输出的文件名
    #[arg(long = "target_file_name", default_value_t = String::from(""))]
    target_file_name: String,

    /// 保存的文件夹
    #[arg(long = "folder", default_value_t = String::from(""))]
    folder: String,

    /// 下载并发数
    #[arg(long = "concurrent", default_value_t = 10)]
    concurrent: i32,

    /// 下载并发数
    #[arg(long = "download_dir", default_value_t = String::from("static/download"))]
    download_dir: String,

    /// 下载请求头，JSON 字符串，如 {"referer":"https://a.com","origin":"https://a.com"}
    #[arg(long = "header", alias = "headers", default_value_t = String::from(""))]
    headers: String,
}

#[derive(clapArgs)]
pub struct ServeArgs {
    /// 接口服务端口
    #[arg(long = "port", default_value_t = 8080)]
    port: u16,
}

fn path_to_md5(url_str: &str) -> Option<String> {
    // 尝试解析 URL
    let parsed_url = Url::parse(url_str).ok()?;
    let path = parsed_url.path(); // 提取 path，比如 "/api/v1/data"

    // 计算 MD5
    let digest = md5::compute(path);
    Some(format!("{:x}", digest)) // 转成十六进制字符串返回
}

impl DownloadArgs {
    fn get_headers(&self) -> Option<HashMap<String, String>> {
        if self.headers.trim().is_empty() {
            return Some(HashMap::new());
        }
        match serde_json::from_str::<HashMap<String, String>>(self.headers.as_str()) {
            Ok(headers) => Some(headers),
            Err(error) => {
                println!("headers 参数必须是有效的 JSON 字符串: {}", error);
                None
            }
        }
    }
    fn get_folder(&self) -> String {
        let mut folder_name = self.folder.clone();
        if folder_name.is_empty() {
            let md5_str = path_to_md5(self.url.clone().as_str());
            if md5_str.is_some() {
                folder_name = md5_str.unwrap()
            } else {
                folder_name = format!("{}", now());
            }
        }
        format!("./{}/{}", self.download_dir, folder_name)
    }
    pub async fn download(&mut self, current_dir: PathBuf) {
        let headers = match self.get_headers() {
            Some(data) => data,
            None => return,
        };
        let folder_name = self.get_folder();
        println!("download folder name == {}", folder_name.clone());
        // url 或者文件夹存在base_info.json 存在即可，否则报错
        if self.url.is_empty() && !check_base_info_exists(folder_name.clone()) {
            println!("url or folder is required!");
            return;
        }
        let file_name = get_file_name(self.target_file_name.to_owned());
        println!("download file name: {}", file_name.clone());
        let res;
        if !self.ffmpeg_download {
            match create_folder(folder_name.clone()) {
                Ok(_) => {
                    if !folder_name.is_empty() {
                        if let Err(_) = env::set_current_dir(&Path::new(&folder_name)) {
                            println!("进入文件夹失败");
                            return;
                        }
                    }
                    res = fast_download(
                        self.url.clone(),
                        file_name,
                        self.folder.clone(),
                        self.concurrent,
                        headers,
                        self.download_dir.clone(),
                        self.ffmpeg_download,
                    )
                    .await
                    .expect("下载失败");
                }
                Err(e) => {
                    println!("创建{}文件夹出错,{}", folder_name.clone(), e);
                    return;
                }
            }
        } else {
            let full_file = format!("{}/{}", folder_name, file_name);
            println!("full file name = {}", full_file.clone());
            res = download(self.url.clone(), full_file.clone()).expect("下载失败");
        }
        println!("生成mp4文件成功");
        if res {
            env::set_current_dir(current_dir).unwrap();
            let data = clear_temp_files(folder_name.clone());
            if data {
                println!("清理临时文件成功");
            } else {
                println!("清理临时文件失败");
            }
        }
    }
}

// 初始化文件夹
fn init_folder() {
    ensure_directory_exists("./static/download");
    ensure_directory_exists("./static/cut");
    ensure_directory_exists("./config");
}

fn ensure_directory_exists(path: &str) {
    let dir_path = Path::new(path);

    // 判断文件夹是否存在
    if !dir_path.exists() {
        // 如果不存在，则创建
        match std::fs::create_dir_all(dir_path) {
            Ok(_) => println!("目录已创建：{}", path),
            Err(e) => eprintln!("创建目录失败：{}，错误信息：{}", path, e),
        }
    }
}

#[actix_web::main]
pub async fn main() {
    init_folder();
    let current_dir = env::current_dir().unwrap();
    let args = Args::parse();
    match args.command {
        Commands::Combine(mut args) => args.combine(),
        Commands::Cut(mut args) => {
            args.cut();
        }
        Commands::Download(mut args) => {
            args.download(current_dir).await;
        }
        Commands::Serve(args) => {
            api::run_server(args.port).await.expect("启动服务失败");
        }
    }
}
