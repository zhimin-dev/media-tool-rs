use crate::common::{download_file, get_url_host, is_url, replace_last_segment};
use std::collections::HashMap;

pub struct HlsM3u8 {
    pub key: String,
    pub list: Vec<String>,
    pub method: Option<HlsM3u8Method>,
    pub iv: String,
    original_url: String,
    folder: String, // 文件夹
    pub sequence: i32, //序号
    pub x_map_uri:String,
    pub extension:String,//视频扩展字段
    headers: HashMap<String, String>,
}

// SAMPLE-AES || AES-128
pub enum HlsM3u8Method {
    SampleAes,
    Aes128,
}

impl HlsM3u8 {
    pub fn new() -> HlsM3u8 {
        HlsM3u8 {
            key: "".to_string(),
            list: vec![],
            method: None,
            iv: "".to_string(),
            original_url: "".to_string(),
            folder: "".to_string(),
            sequence: 0,
            x_map_uri: "".to_string(),
            extension: "ts".to_string(),
            headers: HashMap::new(),
        }
    }

    pub fn set_list(&mut self, list: Vec<String>) {
        self.list = list
    }

    pub fn set_original_url(&mut self, original_url: String, folder: String, headers: HashMap<String, String>) {
        self.original_url = original_url;
        self.folder = folder;
        self.headers = headers;
    }

    pub fn set_key(&mut self, key: String) {
        self.key = key
    }

    pub fn set_x_map_uri(&mut self, uri: String) {
        self.x_map_uri = uri
    }

    pub fn set_extension(&mut self, extension: String) {
        self.extension = extension
    }

    pub fn set_sequence(&mut self, sequence: i32) {
        self.sequence = sequence
    }

    pub async fn set_method_and_key(
        &mut self,
        method: Option<HlsM3u8Method>,
        key: String,
        iv: String,
    ) {
        self.method = method;
        self.key = key.clone();
        self.iv = iv.clone();
        println!("before key is: {}", self.key);
        if !is_url(key.clone()) && !self.original_url.is_empty() {
            if key.starts_with("/") {
                self.set_key(format!(
                    "{}/{}",
                    get_url_host(&self.original_url).expect("获取host失败"),
                    key
                ))
            } else {
                self.set_key(replace_last_segment(&self.original_url, &self.key))
            }
            println!("transfer key,now is: {}", self.key);
        }
        self.convert_local_key().await;
    }

    async fn convert_local_key(&mut self) {
        let res = download_file(self.key.clone(), format!("./{}.bin", self.folder.clone()), &self.headers).await;
        return match res {
            Ok(data) => {
                if data {
                    println!("key 下载成功")
                } else{
                   println!("key 下载出错")
               }
            }
            _ => {
                println!("key 下载出错")
            }
        };
    }
}

pub mod m3u8 {
    use crate::common::{download_file, is_url, replace_last_segment};
    use crate::m3u8::HlsM3u8Method::{Aes128, SampleAes};
    use crate::m3u8::{HlsM3u8, HlsM3u8Method};
    use regex::Regex;
    use std::collections::HashMap;
    use std::fs::File;
    use std::io::Read;

    pub async fn parse_local(local_file: String, target_url: String, folder: String, headers: HashMap<String, String>) -> HlsM3u8 {
        let mut data = File::open(local_file).expect("file not exists");
        let mut str = String::default();
        let _ = data.read_to_string(&mut str);
        str_to_urls(str, target_url.clone(), folder.clone(), headers).await
    }

    async fn str_to_urls(str: String, url: String, folder: String, headers: HashMap<String, String>) -> HlsM3u8 {
        let mut hls_m3u8 = HlsM3u8::new();
        hls_m3u8.set_original_url(url.clone(), folder.clone(), headers);
        let mut list = vec![];
        let arr = str.split("\n").into_iter();
        for i in arr {
            if !i.is_empty() {
                if !i.starts_with("#EXT") {
                    if is_url(i.to_string()) {
                        list.push(i.to_string());
                    } else {
                        if !url.is_empty() {
                            let new_url = replace_last_segment(&url, i);
                            list.push(new_url);
                        }
                    }
                } else {
                    if i.starts_with("#EXT-X-KEY") {
                        let method = get_method_from_regex(i);
                        let uri = get_uri_from_regex(i);
                        let iv = get_iv_from_regex(i);
                        hls_m3u8.set_method_and_key(method, uri, iv).await;
                    } else if i.starts_with("#EXT-X-MEDIA-SEQUENCE:") {
                        let str = i.replace("#EXT-X-MEDIA-SEQUENCE:", "");
                        let mut seq = 0;
                        match str.parse::<i32>() {
                            Ok(data) => seq = data,
                            _ => {}
                        }
                        hls_m3u8.set_sequence(seq);
                    } else if i.starts_with("#EXT-X-MAP:URI=") {
                        let mut uri = i.replace("#EXT-X-MAP:URI=", "");
                        uri = uri.replace("\"", "");
                        hls_m3u8.set_x_map_uri(uri.clone());
                    }
                }
            }
        }
        hls_m3u8.set_list(list);
        hls_m3u8
    }

    pub fn get_method_from_regex(str: &str) -> Option<HlsM3u8Method> {
        let regex = Regex::new(r"(?m)METHOD=(.*),").unwrap();

        let result = regex.captures_iter(str);

        let mut method: Option<HlsM3u8Method> = None;

        println!("parse data {}", str);
        for mat in result {
            let mut data = mat.get(1).expect("error").as_str().to_string();
            println!("{}", data);
            if data.contains("AES-128") {
                method = Some(Aes128)
            } else if data.contains("SAMPLE-AES") {
                method = Some(SampleAes)
            }
        }
        method
    }

    pub fn get_iv_from_regex(str: &str) -> String {
        let regex = Regex::new(r"(?m)IV=(.*)").unwrap();
        let result = regex.captures_iter(str);
        for mat in result {
            return mat.get(1).expect("error").as_str().to_string();
        }
        "".to_string()
    }

    pub fn get_uri_from_regex(str: &str) -> String {
        let regex = Regex::new(r#"(?m)URI="(.*)""#).unwrap();
        let result = regex.captures_iter(str);
        for mat in result {
            return mat.get(1).expect("error").as_str().to_string();
        }
        "".to_string()
    }

    pub async fn parse_url(url: String, folder_name: String, m3u8_file_name: String, headers: HashMap<String, String>) -> HlsM3u8 {
        let hls_m3u8 = HlsM3u8::new();
        let local_file = format!("./{}", m3u8_file_name);
        match download_file(url.clone(), local_file.clone(), &headers).await {
            Ok(data) => {
                if data {
                    parse_local(
                        local_file.clone().to_string(),
                        url.clone(),
                        folder_name.clone(),
                        headers,
                    )
                        .await
                } else {
                    hls_m3u8
                }
            }
            _ => hls_m3u8,
        }
    }
}
