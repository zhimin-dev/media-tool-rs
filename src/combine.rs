pub mod parse {
    use crate::cmd::cmd::{
        clear_temp_files, combine, combine_ts, get_video_info, transcode_video_to_spec_params,
    };
    use crate::common::now;
    use crate::m3u8::HlsM3u8Method;
    use image::EncodableLayout;
    use openssl::symm::{decrypt, Cipher};
    use std::fmt::Error;
    use std::fs::{self, read, File, OpenOptions};
    use std::io::prelude::*;
    use std::io::{BufReader, BufWriter};
    use std::path::Path;
    use std::path::PathBuf;
    use tempfile::tempdir;

    pub fn get_reg_files(
        reg_name: String,
        reg_start: i32,
        reg_end: i32,
    ) -> Result<Vec<String>, Error> {
        let mut files = vec![];
        for i in reg_start..=reg_end {
            let file = reg_name.replace("(.*)", &i.to_string());
            files.push(file);
        }
        Ok(files)
    }

    pub fn get_reg_file_name(reg_name: String) -> String {
        let path = Path::new(reg_name.as_str());
        if let Some(parent_name) = path
            .parent()
            .and_then(|parent| parent.file_name())
            .and_then(|name| name.to_str())
        {
            if !parent_name.trim().is_empty() {
                return parent_name.to_string();
            }
        }

        let cleaned = reg_name.replace("(.*)", "");
        let candidate = Path::new(cleaned.as_str())
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or(cleaned.as_str())
            .trim_matches('/');

        if candidate.is_empty() || candidate == ".mp4" {
            now().to_string()
        } else {
            candidate.to_string()
        }
    }

    fn get_temp_file() -> String {
        if let Ok(dir) = tempdir() {
            if let Some(a) = dir.path().join(format!("{}.txt", now())).to_str() {
                return a.to_owned();
            }
        }
        return String::default();
    }

    pub fn to_files(base_dir: &Path) -> Result<String, Error> {
        if let Err(error) = fs::create_dir_all(base_dir) {
            println!("创建目录失败 {}: {}", base_dir.display(), error);
            return Ok(format!("{}.txt", now()));
        }
        let file = base_dir.join(format!("{}.txt", now()));
        Ok(file.display().to_string())
    }

    pub fn white_to_files(files: Vec<String>, file_name: String) -> Result<bool, Error> {
        println!("{}", file_name.clone());
        let file_path = Path::new(file_name.as_str());
        if let Some(parent) = file_path.parent() {
            if !parent.as_os_str().is_empty() {
                if let Err(error) = fs::create_dir_all(parent) {
                    println!("无法创建目录 {}: {}", parent.display(), error);
                    return Ok(false);
                }
            }
        }

        let mut file = match File::create(file_name.as_str()) {
            Ok(file) => file,
            Err(error) => {
                println!("无法创建文件 {}: {}", file_name, error);
                return Ok(false);
            }
        };
        for num in files {
            let str = format!("file \'{}\'", num);
            if let Err(error) = file.write_all(str.as_bytes()) {
                println!("写入文件失败 {}: {}", file_name, error);
                return Ok(false);
            }
            if let Err(error) = file.write_all(b"\n") {
                println!("写入文件失败 {}: {}", file_name, error);
                return Ok(false);
            }
        }
        Ok(true)
    }

    pub fn combine_video(
        files: Vec<String>,
        file_name: String,
        target_file_name: String,
        source_dir: PathBuf,
        same_param_index: i32,
        set_a_b: i32,
        set_v_b: i32,
        set_fps: i32,
        set_width: i32,
        set_height: i32,
    ) -> Result<bool, Error> {
        if let Err(error) = fs::create_dir_all(&source_dir) {
            println!("创建目录失败 {}: {}", source_dir.display(), error);
            return Ok(false);
        }

        if same_param_index == -1
            && set_a_b == 0
            && set_v_b == 0
            && set_fps == 0
            && set_width == 0
            && set_height == 0
        {
            let wrote = white_to_files(files.clone(), file_name.clone()).unwrap_or(false);
            if !wrote {
                return Ok(false);
            }
            let target = resolve_output_path(&source_dir, target_file_name);
            return combine(file_name.clone(), target);
        }
        // 如果不指定视频参数相同的索引，那么就按照传过来的参数处理
        let mut a_b = 128000; // audio bitrate
        let mut v_b = 1200000; // video bitrate
        let mut fps = 30; // fps
        let mut width = 1280; // width
        let mut height = 720; // height
        if same_param_index != -1 {
            let info = get_video_info(&files.get(same_param_index as usize).unwrap().to_string());
            match info {
                Some(data_info) => {
                    if data_info.audio_rate > 0 {
                        a_b = data_info.audio_rate;
                    }
                    if data_info.fps > 0.0 {
                        fps = data_info.fps as i32;
                    }
                    if data_info.video_rate > 0 {
                        v_b = data_info.video_rate;
                    }
                    if data_info.width > 0 {
                        width = data_info.width;
                    }
                    if data_info.height > 0 {
                        height = data_info.height;
                    }
                }
                None => return Ok(false),
            }
        } else {
            if set_a_b > 0 {
                a_b = set_a_b;
            }
            if set_fps > 0 {
                fps = set_fps;
            }
            if set_v_b > 0 {
                v_b = set_v_b;
            }
            if set_width > 0 {
                width = set_width
            }
            if set_height > 0 {
                height = set_height
            }
        }
        println!(
            "ab {} vb {}  fps {} width {} height {}",
            a_b, v_b, fps, width, height
        );
        let target = resolve_output_path(&source_dir, target_file_name);
        transcode_videos_to_same_params(
            files.clone(),
            file_name.clone(),
            target,
            source_dir,
            a_b,
            v_b,
            fps,
            width,
            height,
        )
    }

    // cargo run -- combine -r="/Users/meow.zang/RustroverProjects/ffmpeg-tool-rs/images/video/(.*).mp4" --reg-file-start=1 --reg-file-end=2 --same_param_index=1
    fn transcode_videos_to_same_params(
        files: Vec<String>,
        file: String,
        target: String,
        source_dir: PathBuf,
        a_b: i32,
        v_b: i32,
        fps: i32,
        width: i32,
        height: i32,
    ) -> Result<bool, Error> {
        let mut index: i32 = 0;
        let mut result_files = vec![];
        // 先将ts文件转成mp4
        for i in files.clone() {
            let file_name = source_dir
                .join(format!("_temp_{}.mp4", index))
                .display()
                .to_string();
            result_files.push(file_name.clone());
            let _ = transcode_video_to_spec_params(
                i.clone(),
                file_name.clone(),
                a_b,
                v_b,
                fps,
                width,
                height,
            );
            index += 1;
        }
        // 在将mp4文件合并成一个文件
        let combine_res = mp4_files_combine_one(result_files.clone(), file, target);
        match combine_res {
            Ok(data) => {
                if data {
                    // 清除文件
                    let _ = clear_temp_video_files(result_files.clone());
                }
                Ok(data)
            }
            Err(e) => Err(e),
        }
    }

    // 清理_temp_.mp4开头的文件
    fn clear_temp_video_files(files: Vec<String>) -> Result<bool, Error> {
        Ok(true)
    }

    fn mp4_files_combine_one(
        mp4_files: Vec<String>,
        file: String,
        target: String,
    ) -> Result<bool, Error> {
        println!("file {}, target {}", file.clone(), target.clone());
        let wrote = white_to_files(mp4_files.clone(), file.clone()).unwrap_or(false);
        if !wrote {
            return Ok(false);
        }
        combine(file.clone(), target)
    }

    async fn combine_without_crypto(
        reg_name: String,
        reg_start: i32,
        reg_end: i32,
        target_name: String,
        source_dir: PathBuf,
    ) -> Result<bool, Error> {
        let files = get_reg_files(reg_name.clone(), reg_start, reg_end).expect("解析失败");
        let file_name = to_files(&source_dir).expect("生成文件失败");
        let mut target = source_dir.join(get_reg_file_name(reg_name.to_owned())).display().to_string();
        if !target_name.is_empty() {
            target = resolve_output_path(&source_dir, target_name.clone());
        }
        let wrote = white_to_files(files.clone(), file_name.clone()).unwrap_or(false);
        if !wrote {
            return Ok(false);
        }
        let res = combine_ts(file_name.clone(), target).expect("合并文件失败");
        Ok(res)
    }

    #[allow(dead_code)]
    async fn combine_with_simple_aes(
        reg_name: String,
        reg_start: i32,
        reg_end: i32,
        target_name: String,
        key: String,
        iv: String,
        sequence: i32,
    ) -> Result<bool, Error> {
        // 未实现
        Ok(false)
    }

    async fn decrypt_video_file(key: &[u8], iv: &[u8], sequence_number: u8, segment_url: &str) {
        let mut file = File::open(segment_url).expect("文件不存在");
        let mut file_data = Vec::new();
        let _ = file.read_to_end(&mut file_data).expect("读文件失败");

        let cipher = Cipher::aes_128_cbc();
        let decrypted_data =
            decrypt(cipher, &key, Some(&iv), &file_data.as_slice()).expect("解析失败");

        let file_name = format!("decrypted-{}.ts", sequence_number);
        let mut file = match File::create(&file_name) {
            Err(why) => panic!("couldn't create: {}", why),
            Ok(file) => file,
        };

        match file.write_all(&decrypted_data) {
            Err(why) => panic!("couldn't write to: {}", why),
            Ok(_) => println!("successfully wrote to {}", &file_name),
        }
    }

    async fn combine_with_aes_128(
        reg_start: i32,
        reg_end: i32,
        target_name: String,
        key: String,
        iv: String,
        sequence: i32,
        extension: String,
        source_dir: PathBuf,
    ) -> Result<bool, Error> {
        let key_file = format!("./{}.bin", key.clone());
        println!("pass key {}, iv {}", key_file.clone(), iv.clone());
        let key_data = read(key_file).expect("打开文件失败");
        println!("----映射的文件大小: {}", key_data.len());
        let slice: &[u8] = &key_data; // 转为 &[u8]
        println!("----映射的文件大小: {} {}", key_data.len(), slice.len());
        let files = get_reg_files(format!("(.*).{}", extension.clone()), reg_start, reg_end)
            .expect("解析失败");
        let mut start_se = sequence;
        for i in files.clone() {
            let _ = decrypt_video_file(slice, iv.clone().as_bytes(), start_se as u8, &i).await;
            start_se += 1;
        }
        return combine_without_crypto(
            "decrypted-(.*).ts".to_string(),
            reg_start,
            reg_end,
            target_name,
            source_dir,
        )
        .await;
    }

    fn append_file_to_output(input_path: &str, output: &mut BufWriter<File>) -> Result<(), Error> {
        let input_file = File::open(input_path).expect("open file error");
        let mut reader = BufReader::new(input_file);
        let mut buffer = Vec::new();

        reader.read_to_end(&mut buffer).expect("read to end error");
        output.write_all(&buffer).expect("write all error");
        Ok(())
    }

    fn m4s_file_combine(
        reg_name: String,
        reg_start: i32,
        reg_end: i32,
        target_name: String,
        x_map_uri: String,
        extension: String,
        source_dir: PathBuf,
    ) -> Result<bool, Error> {
        // 输出文件，覆盖或创建新文件
        let output_file = OpenOptions::new()
            .create(true)
            .write(true)
            .truncate(true)
            .open(resolve_output_path(&source_dir, target_name.clone()))
            .expect("create file error");

        let mut writer = BufWriter::new(output_file);

        // 要合并的文件列表（顺序非常重要）
        let mut files: Vec<String> = vec![];
        if !x_map_uri.is_empty() {
            files.push(format!("-1.{}", extension.clone()));
        }

        let reg_files = get_reg_files(reg_name.clone(), reg_start, reg_end).expect("解析失败");
        for i in reg_files.clone() {
            files.push(i.clone());
        }

        for file in &files.clone() {
            println!("合并中：{}", file);
            append_file_to_output(file, &mut writer)?;
        }

        writer.flush().expect("flush error");
        println!("合并完成：output.mp4");

        Ok(true)

        // let combine_file = String::from("list.txt");
        // // 输出文件，覆盖或创建新文件
        // let _ = OpenOptions::new()
        //     .create(true)
        //     .write(true)
        //     .truncate(true)
        //     .open(combine_file.clone()).expect("create file error");
        //
        // // 要合并的文件列表（顺序非常重要）
        // let mut files = vec![];
        //
        // let reg_files = get_reg_files(reg_name.clone(), reg_start, reg_end).expect("解析失败");
        // for i in reg_files.clone() {
        //     files.push(i.to_string());
        // }
        // let write_list = white_to_files(files, combine_file.clone()).expect("write list.txt error");
        // if !write_list {
        //     return Ok(false);
        // }
        //
        // let res = combine_ts(combine_file.clone(), target_name).expect("合并文件失败");
        // Ok(res)
    }

    pub async fn handle_combine_ts(
        reg_name: String,
        reg_start: i32,
        reg_end: i32,
        target_name: String,
        method: Option<HlsM3u8Method>,
        key: String,
        iv: String,
        sequence: i32,
        x_map_uri: String,
        extension: String,
        source_dir: PathBuf,
    ) -> Result<bool, Error> {
        if !x_map_uri.is_empty() {
            return m4s_file_combine(
                reg_name.clone(),
                reg_start,
                reg_end,
                target_name.clone(),
                x_map_uri.clone(),
                extension.clone(),
                source_dir,
            );
        }
        match method {
            Some(HlsM3u8Method::Aes128) => {
                println!("aes 128 decode");
                combine_with_aes_128(
                    reg_start,
                    reg_end,
                    target_name,
                    key.clone(),
                    iv.clone(),
                    sequence,
                    extension.clone(),
                    source_dir,
                )
                .await
            }
            Some(HlsM3u8Method::SampleAes) => {
                println!("simple aes");
                combine_with_simple_aes(
                    reg_name,
                    reg_start,
                    reg_end,
                    target_name,
                    key.clone(),
                    iv.clone(),
                    sequence,
                )
                .await
            }
            None => {
                println!("no crypto");
                combine_without_crypto(reg_name, reg_start, reg_end, target_name, source_dir).await
            }
        }
    }

    fn resolve_output_path(base_dir: &Path, target_name: String) -> String {
        let candidate = Path::new(target_name.as_str());
        if candidate.is_absolute() {
            return target_name;
        }

        base_dir.join(candidate).display().to_string()
    }
}
