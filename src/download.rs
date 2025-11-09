use crate::common::download_file;
use serde::{Deserialize, Serialize};
use std::fs;
use std::fs::File;
use std::io::{Error, Read};
use tokio::runtime::Runtime;
use crate::m3u8::HlsM3u8;

struct VideoTs {
    index: i32,
    url: String,
    extension:String,
}

impl VideoTs {
    pub fn new() -> VideoTs {
        VideoTs {
            index: 0,
            url: "".to_string(),
            extension: "".to_string(),
        }
    }

    pub fn set(&mut self, index: i32, url: String, extension:String) {
        self.index = index;
        self.url = url.clone();
        self.extension = extension.clone()
    }
}

#[derive(Debug, Deserialize, Serialize)]
pub struct BaseInfo {
    pub url: String,
    pub m3u8_name: String,
}

impl BaseInfo {
    pub fn new() -> BaseInfo {
        BaseInfo {
            url: "".to_string(),
            m3u8_name: "".to_string(),
        }
    }
    pub fn set_host(&mut self, url: String) {
        self.url = url
    }

    pub fn set_m3u8_name(&mut self, m3u8_name: String) {
        self.m3u8_name = m3u8_name
    }

    pub fn generate(self, folder: String) -> Result<(), Error> {
        let data = serde_json::to_vec(&self)?;
        Ok(std::fs::write(folder, &data)?)
    }
}

fn read_base_info(file_name: &str) -> Result<BaseInfo, std::io::Error> {
    let path = std::path::Path::new(file_name);
    let mut file = std::fs::File::open(path)?;
    let mut contents = String::new();
    file.read_to_string(&mut contents)?;

    let base_info: BaseInfo = serde_json::from_str(&contents)?;
    Ok(base_info)
}

fn file_exists(file_name:String) -> bool {
    let res = File::open(file_name);
    return match res {
        Ok(data) => {
            println!("{:?}----", data.metadata());
            return true
        },
        Err(e) => {
            return false
        }
    }
}

pub mod download {
    use crate::combine::parse::handle_combine_ts;
    use crate::common::{is_url, now, replace_last_segment};
    use crate::download::{download_ts_file, download_ts_file_async, file_exists, read_base_info, BaseInfo, VideoTs};
    use crate::m3u8::m3u8::{parse_local, parse_url};
    use std::fmt::{format, Error};
    use std::{fs, io};
    use std::sync::{mpsc, Arc, Mutex};
    use std::thread;
    use crate::cmd::cmd::check_video_validity;

    pub async fn fast_download(
        pass_url: String,
        _file_name: String,
        folder: String,
        concurrent: i32,
    ) -> Result<bool, Error> {
        let mut hls_m3u;
        let mut url = pass_url;
        let base_info = "base_info.json";
        let mut m3u8_file_name = format!("{}.m3u8", now());
        let mut base_info_obj = BaseInfo::new();
        let read_base_info = read_base_info(&base_info.to_string());
        match read_base_info {
            Ok(base_info_data) => {
                m3u8_file_name = base_info_data.m3u8_name;
                url = base_info_data.url;
            }
            Err(_) => {
                base_info_obj.set_host(url.clone());
                base_info_obj.set_m3u8_name(m3u8_file_name.clone());
                let _ = base_info_obj.generate(base_info.to_string());
            }
        }
        if file_exists(m3u8_file_name.clone()) {
            println!("now is read local m3u8 files");
            hls_m3u = parse_local(format!("{}", m3u8_file_name.clone()), url.clone(), m3u8_file_name.clone()).await;
            println!("hls_m3u = {:?}----", hls_m3u.list.len());
        }else{
            if is_url(url.clone()) {
                hls_m3u = parse_url(url.clone(), folder.clone(), m3u8_file_name.clone()).await;
            } else {
                hls_m3u = parse_local(url.clone(), String::default(), folder.clone()).await;
            }
        }
        let mut extension= "ts".to_string();
        if !hls_m3u.x_map_uri.is_empty() {
            extension = "m4s".to_string();
            println!("-------x-map-uri----{}", hls_m3u.x_map_uri.clone());
            let mut video = VideoTs::new();
            let mut x_url = hls_m3u.x_map_uri.clone();
            if !is_url(x_url.clone()) {
                x_url = replace_last_segment(url.clone().as_str(), x_url.clone().as_str())
            }
            println!("-----x-url---{}", x_url.clone());
            video.url = x_url;
            video.index = -1;
            video.extension = extension.clone();
            download_ts_file_async(video).await;
        }
        hls_m3u.set_extension(extension.clone());
        let mut ts_list = vec![];
        let mut ts_index = 0;
        for x in &hls_m3u.list {
            let mut ts = VideoTs::new();
            ts.set(ts_index, x.clone(), extension.clone());
            ts_list.push(ts);
            ts_index += 1;
        }
        let total = ts_list.len();
        // 分批下载文件
        let (tx, rx) = mpsc::channel();
        let (data_tx, data_rx) = mpsc::channel();
        let new_data_rx = Arc::new(Mutex::new(data_rx));

        for _i in 0..concurrent {
            let tx_clone = tx.clone();
            let data_rx_clone = Arc::clone(&new_data_rx);

            thread::spawn(move || loop {
                let item = {
                    let rx_lock = data_rx_clone.lock().unwrap();
                    match rx_lock.recv() {
                        Ok(item) => item,
                        Err(_) => break,
                    }
                };
                let result = download_ts_file(item);
                tx_clone.send(result).unwrap();
            });
        }
        for value in ts_list {
            data_tx.send(value).unwrap();
        }
        drop(tx); // 发送完成后关闭队列
        let mut i = 0;
        loop {
            if i == total {
                break;
            }
            let result = rx.recv();
            match result {
                Ok(_) => {
                    i += 1;
                }
                Err(_e) => {}
            }
        }
        println!("----download files finished");
        let mut start = 0;
        if !hls_m3u.x_map_uri.is_empty() {
            start = -1;
        }
        let res = handle_combine_ts(
            String::from(format!("(.*).{}", hls_m3u.extension)),
            start,
            (total - 1) as i32,
            _file_name.clone(),
            hls_m3u.method,
            folder.clone(),
            hls_m3u.iv,
            hls_m3u.sequence,
            hls_m3u.x_map_uri.clone(),
            hls_m3u.extension.clone(),
        )
        .await?;
        return if res {
            let f_name = format!("{}", _file_name.clone());
            println!("---f_name {}", f_name.clone());
            check_video_validity(f_name.as_str())
        } else {
            Ok(false)
        }
    }

    pub fn create_folder(folder: String) -> io::Result<()> {
        // 检查文件夹是否存在
        if !fs::metadata(folder.clone()).is_ok() {
            // 文件夹不存在，创建文件夹
            match fs::create_dir(folder.clone()) {
                Ok(_) => Ok(()),
                Err(e) => {
                    println!("创建文件夹时出错：{}", e);
                    Err(e)
                }
            }
        } else {
            Ok(())
        }
    }

    pub fn get_file_name(file_name: String) -> String {
        let mut target = file_name;
        if target.is_empty() {
            target = format!("{}.mp4", now());
        }
        target
    }
}

fn download_ts_file(video_ts: VideoTs) -> bool {
    println!("---pass {}", video_ts.url.clone());
    let download_file_name = format!("./{}.{}", video_ts.index, video_ts.extension.clone());
    match fs::metadata(download_file_name.clone()) {
        Ok(_) => {
            println!("file {} exists", video_ts.url.clone());
            true
        }
        Err(_) => {
            let rt = Runtime::new().unwrap();
            rt.block_on(async {
                println!("download ts file {}", video_ts.url.clone());
                let res = download_file(video_ts.url.clone(), download_file_name, ).await;
                return match res {
                    Ok(data) => data,
                    _ => false,
                };
            })
        }
    }
}

async fn download_ts_file_async(video_ts: VideoTs) ->  bool {
    println!("---pass {}", video_ts.url.clone());
    let download_file_name = format!("./{}.{}", video_ts.index, video_ts.extension.clone());
    match fs::metadata(download_file_name.clone()) {
        Ok(_) => {
            println!("file {} exists", video_ts.url.clone());
            true
        }
        Err(_) => {
            println!("download ts file {}", video_ts.url.clone());
            let res = download_file(video_ts.url.clone(), download_file_name, ).await;
            return match res {
                Ok(data) => data,
                _ => false,
            };
        }
    }
}