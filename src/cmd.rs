use regex::Regex;
use serde::{Deserialize, Serialize};

#[derive(Debug, Deserialize, Serialize)]
pub struct VideoInfo {
    pub width: i32,
    pub height: i32,
    pub duration: i32, //毫秒
    pub video_rate: i32,
    pub audio_rate: i32,
    pub fps: f32,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct Ffprobe {
    streams: Vec<FfprobeStream>,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct FfprobeStream {
    codec_type: String,
    width: Option<i32>,
    height: Option<i32>,
    codec_name: String,
    channels: Option<i32>,
    avg_frame_rate: String,
    bit_rate: String,
    duration_ts: Option<i32>,
}

impl From<Ffprobe> for VideoInfo {
    fn from(a: Ffprobe) -> Self {
        let mut video = VideoInfo {
            width: 0,
            height: 0,
            duration: 0,
            video_rate: 0,
            audio_rate: 0,
            fps: 0.0,
        };

        for i in a.streams {
            if i.codec_type == "video" {
                video.width = i.width.unwrap();
                video.height = i.height.unwrap();
                let regex = Regex::new(r"(?m)(\d+)\/(\d+)").unwrap();
                let string = i.avg_frame_rate;
                match regex.captures(&string) {
                    Some(cap) => {
                        // 获取第一个匹配的日期
                        let year = cap[1].to_string();
                        let month = cap[2].to_string();
                        video.fps = format!(
                            "{:.2}",
                            (year.parse::<f32>().unwrap()) / (month.parse::<f32>().unwrap())
                        )
                        .parse::<f32>()
                        .unwrap()
                    }
                    None => {}
                }
                video.duration = i.duration_ts.unwrap() / 1000;
                video.video_rate = i.bit_rate.parse::<i32>().unwrap();
            } else if i.codec_type == "audio" {
                video.audio_rate = i.bit_rate.parse::<i32>().unwrap();
            }
        }
        return video;
    }
}

pub mod cmd {
    use crate::cmd::{Ffprobe, VideoInfo};
    use std::env;
    use std::fmt::{format, Error};
    use std::fs::{self};
    use std::path::Path;
    use std::process::{Command, Stdio};

    fn ensure_output_extension(target: &str, default_ext: &str) -> String {
        if Path::new(target).extension().is_none() {
            format!("{}.{}", target, default_ext)
        } else {
            target.to_string()
        }
    }

    pub fn cut(file: String, start: u32, duration: u32, target: String) -> Result<bool, Error> {
        let target_with_ext = ensure_output_extension(&target, "mp4");
        let output = match Command::new("ffmpeg")
            .arg("-i")
            .arg(&file)
            .arg("-ss")
            .arg(start.to_string())
            .arg("-t")
            .arg(duration.to_string())
            .arg("-c:v")
            .arg("libx264")
            .arg("-c:a")
            .arg("aac")
            .arg(&target_with_ext)
            .output()
        {
            Ok(out) => out,
            Err(e) => {
                println!("ffmpeg 执行失败（截取）: {}", e);
                return Err(Error);
            }
        };
        if output.status.success() {
            Ok(true)
        } else {
            println!("ffmpeg 截取失败-{}", output.status);
            println!("ffmpeg stderr: {}", String::from_utf8_lossy(&output.stderr));
            Ok(false)
        }
    }

    pub fn check_base_info_exists(folder_name: String) -> bool {
        true
    }

    pub fn clear_temp_files(folder_name: String) -> bool {
        let current_dir = env::current_dir().unwrap();
        let clear_ext = vec!["ts", "m3u8", "txt"];
        let path_str = format!("./{}", folder_name.to_owned());
        let dir_path = Path::new(path_str.as_str());
        println!(
            "now path {}, pass dir {:?}",
            current_dir.as_os_str().to_str().unwrap(),
            dir_path
        );

        if !dir_path.is_dir() {
            println!("-----path: {:?} is not dir", dir_path);
            return false;
        }
        for i in clear_ext {
            for entry in fs::read_dir(dir_path).unwrap() {
                let entry = entry.unwrap();
                let path = entry.path();

                if !path.is_file() {
                    continue;
                }

                if let Some(ext) = path.extension() {
                    if ext.as_encoded_bytes() == i.as_bytes() {
                        fs::remove_file(path).unwrap();
                    }
                }
            }
        }
        true
    }

    pub fn download(url: String, file_name: String) -> Result<bool, Error> {
        let target_with_ext = ensure_output_extension(&file_name, "mp4");
        let output = match Command::new("ffmpeg")
            .arg("-i")
            .arg(&url)
            .arg("-c")
            .arg("copy")
            .arg("-bsf:a")
            .arg("aac_adtstoasc")
            .arg(&target_with_ext)
            .output()
        {
            Ok(out) => out,
            Err(e) => {
                println!("ffmpeg 执行失败（下载）: {}", e);
                return Err(Error);
            }
        };
        if output.status.success() {
            Ok(true)
        } else {
            println!("ffmpeg 下载失败-{}", output.status);
            println!("ffmpeg stderr: {}", String::from_utf8_lossy(&output.stderr));
            Ok(false)
        }
    }

    //ffmpeg -f concat -i input.txt -c copy output.mp4
    pub fn combine(file: String, target: String) -> Result<bool, Error> {
        let target_with_ext = ensure_output_extension(&target, "mp4");

        // 验证 concat 列表文件存在
        let concat_path = Path::new(&file);
        if !concat_path.exists() {
            println!(
                "[combine] 错误：concat 列表文件不存在: {}",
                concat_path.display()
            );
            return Ok(false);
        }

        let cmd = format!(
            "ffmpeg -y -f concat -safe 0 -i \"{}\" -c copy \"{}\"",
            file, target_with_ext
        );
        println!("[combine] CMD: {}", cmd);

        let output = match Command::new("ffmpeg")
            .arg("-y")
            .arg("-f")
            .arg("concat")
            .arg("-safe")
            .arg("0")
            .arg("-i")
            .arg(&file)
            .arg("-c")
            .arg("copy")
            .arg(&target_with_ext)
            .output()
        {
            Ok(out) => out,
            Err(e) => {
                println!("[combine] ffmpeg 执行失败: {}", e);
                return Err(Error);
            }
        };
        if output.status.success() {
            Ok(true)
        } else {
            println!("ffmpeg 合并失败-{}", output.status);
            println!("ffmpeg stderr: {}", String::from_utf8_lossy(&output.stderr));
            Ok(false)
        }
    }

    // ffmpeg -i input.mp4 -b:v <视频码率> -b:a <音频码率> -r <帧率> output.mp4
    // ffmpeg -i input.mp4 -vf "scale=1280:720" -b:v 1500k -b:a 192k -r 30 -c:v libx264 -c:a aac output.mp4
    pub fn transcode_video_to_spec_params(
        file: String,
        target: String,
        a_b: i32,
        v_b: i32,
        fps: i32,
        width: i32,
        height: i32,
    ) -> Result<bool, Error> {
        let target_with_ext = ensure_output_extension(&target, "mp4");
        let output = match Command::new("ffmpeg")
            .arg("-i")
            .arg(&file)
            .arg("-vf")
            .arg(format!("scale={}:{}", width, height))
            .arg("-b:v")
            .arg(v_b.to_string())
            .arg("-b:a")
            .arg(a_b.to_string())
            .arg("-r")
            .arg(fps.to_string())
            .arg("-c:v")
            .arg("libx264")
            .arg("-c:a")
            .arg("aac")
            .arg(&target_with_ext)
            .output()
        {
            Ok(out) => out,
            Err(e) => {
                println!("ffmpeg 执行失败（转码）: {}", e);
                return Err(Error);
            }
        };
        if output.status.success() {
            Ok(true)
        } else {
            println!("ffmpeg 转码失败-{}", output.status);
            println!("ffmpeg stderr: {}", String::from_utf8_lossy(&output.stderr));
            Ok(false)
        }
    }

    //ffmpeg -f concat -safe 0 -i filelist.txt -c copy output.mp4
    pub fn combine_ts(file: String, target: String) -> Result<bool, Error> {
        let target_with_ext = ensure_output_extension(&target, "mp4");

        // 验证 concat 列表文件存在
        let concat_path = Path::new(&file);
        if !concat_path.exists() {
            println!(
                "[combine_ts] 错误：concat 列表文件不存在: {}",
                concat_path.display()
            );
            return Ok(false);
        }

        let cmd1 = format!(
            "ffmpeg -y -f concat -safe 0 -i \"{}\" -c copy \"{}\"",
            file, target_with_ext
        );
        println!("[combine_ts] CMD: {}", cmd1);

        let output = match Command::new("ffmpeg")
            .arg("-y")
            .arg("-f")
            .arg("concat")
            .arg("-safe")
            .arg("0")
            .arg("-i")
            .arg(&file)
            .arg("-c")
            .arg("copy")
            .arg(&target_with_ext)
            .output()
        {
            Ok(out) => out,
            Err(e) => {
                println!("[combine_ts] ffmpeg 执行失败: {}", e);
                return Err(Error);
            }
        };

        if output.status.success() {
            Ok(true)
        } else {
            println!("combine_ts error, ffmpeg code: {}", output.status);
            println!("ffmpeg stderr: {}", String::from_utf8_lossy(&output.stderr));
            Ok(false)
        }
    }

    pub fn check_video_validity(file_path: &str) -> Result<bool, Error> {
        let output = match Command::new("ffprobe")
            .args(&["-v", "error", "-show_format", "-show_streams"])
            .arg(file_path)
            .stderr(Stdio::piped())
            .output()
        {
            Ok(out) => out,
            Err(e) => {
                println!("ffprobe 执行失败（校验视频有效性）: {}", e);
                return Err(Error);
            }
        };

        let stderr = String::from_utf8_lossy(&output.stderr);
        Ok(stderr.trim().is_empty())
    }

    pub fn get_video_duration_secs(file: &str) -> Option<f64> {
        let output = Command::new("ffprobe")
            .args(&[
                "-v", "error",
                "-show_entries", "format=duration",
                "-of", "default=noprint_wrappers=1:nokey=1",
            ])
            .arg(file)
            .output()
            .ok()?;
        if output.status.success() {
            let s = String::from_utf8_lossy(&output.stdout);
            s.trim().parse::<f64>().ok()
        } else {
            None
        }
    }

    pub fn get_video_info(file: &str) -> Option<VideoInfo> {
        println!("pass file name： {}---", file);
        let mut ffprobe = Command::new("ffprobe");
        let prob_result = match ffprobe
            .arg("-v")
            .arg("quiet")
            .arg("-print_format")
            .arg("json")
            .arg("-show_format")
            .arg("-show_streams")
            .arg(file.to_owned())
            .output()
        {
            Ok(out) => out,
            Err(e) => {
                println!("ffprobe 执行失败（获取视频信息）: {}", e);
                return None;
            }
        };
        println!("ffmpeg status : {}", prob_result.status);
        if prob_result.status.success() {
            let stdout_str = match String::from_utf8(prob_result.stdout) {
                Ok(s) => s,
                Err(e) => {
                    println!("ffprobe 输出解析失败: {}", e);
                    return None;
                }
            };
            let res_data: Ffprobe = match serde_json::from_str(&stdout_str) {
                Ok(data) => data,
                Err(e) => {
                    println!("无法解析 JSON: {}", e);
                    return None;
                }
            };
            let video_info: VideoInfo = res_data.into();
            Some(video_info)
        } else {
            None
        }
    }
}

#[cfg(test)]
mod tests {
    use crate::cmd::cmd::get_video_info;

    #[test]
    fn test_add() {
        let file = "https://cdn.poizon.com/du_app/2020/video/222341803_byte5570027_dur0_04e0fa415de1bd39e16dfe3b7085ddb8_1608103378948_du_android_w1088h1920.mp4";
        let data = match get_video_info(file) {
            None => {}
            Some(a) => {
                println!("{:?}", a);
            }
        };
    }
}
