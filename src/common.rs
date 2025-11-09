use std::fmt::{format, Error};
use std::fs;
use std::fs::File;
use std::time::{SystemTime, UNIX_EPOCH};
use url::Url;

pub fn now() -> u64 {
    let now = SystemTime::now();
    return now
        .duration_since(UNIX_EPOCH)
        .expect("Time went backwards")
        .as_secs();
}

pub fn is_url(_str: String) -> bool {
    let _url = &_str;
    let check_url = Url::parse(_url);
    return match check_url {
        Ok(_) => true,
        Err(_) => false,
    };
}

pub fn get_url_host(str: &str) -> Result<String, Error> {
    if str.is_empty() {
        return Ok("".to_string());
    }
    let binding = Url::parse(str).unwrap();
    let url = binding.host_str().expect("解析url失败");
    Ok(url.to_string())
}

pub fn replace_last_segment(url: &str, replacement: &str) -> String {
    let mut components: Vec<&str> = url.split('/').collect();
    if let Some(last_segment) = components.last_mut() {
        *last_segment = replacement;
    }
    components.join("/")
}

pub async fn download_file(url: String, file_name: String) -> Result<bool, Error> {
    let resp = reqwest::get(&url).await.expect("get url data error");
    if resp.status() == 200 {
        let body = resp.bytes().await;
        match body {
            Ok(bytes) => {
                fs::write(file_name.clone(), bytes).expect(format!("write file error {}", file_name.clone()).as_str());
                Ok(true)
            },
            Err(e) => {
                println!("get data error");
                Ok(false)
            }
        }
    }else{
        println!("download file status is not 200, now is {}", resp.status());
        Ok(false)
    }
}