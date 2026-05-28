use crate::repeat::com::RepeatCheck;
use blake2::{Blake2s256, Digest};
use clap::Error;
use file_hashing::{get_hash_files, ProgressInfo};
use image::imageops;
use std::ffi::OsString;
use std::fs::Metadata;
use std::hash::Hash;
use std::io::Write;

#[cfg(target_os = "macos")]
use std::os::macos::fs::MetadataExt;

#[cfg(any(target_os = "linux", target_os = "android"))]
use std::os::unix::fs::MetadataExt;

#[cfg(target_os = "windows")]
use std::os::windows::fs::MetadataExt;

use std::path::Path;
use std::path::PathBuf;
use std::{fs, io};
use walkdir::WalkDir;

struct ImageCheck {
    one_url: String,
    two_url: String,
    check_dir: String,
}

impl ImageCheck {}

impl RepeatCheck for ImageCheck {
    fn check(&self) -> bool {
        return false;
    }
}

fn get_file_md5(url: String) -> String {
    let walk_dir = WalkDir::new(url);
    let mut paths: Vec<PathBuf> = Vec::new();

    for file in walk_dir.into_iter().filter_map(|file| file.ok()) {
        if file.metadata().unwrap().is_file() {
            paths.push(file.into_path());
        }
    }

    let mut hash = Blake2s256::new();
    let result = get_hash_files(&paths, &mut hash, 4, |info| match info {
        ProgressInfo::Yield(done_files) => {
            println!("done files {}/{}", done_files, paths.len())
        }
        ProgressInfo::Error(error) => println!("error: {}", error),
    })
    .unwrap();

    result
}

fn is_file_same(one_url: String, two_url: String) -> bool {
    get_file_md5(one_url) == get_file_md5(two_url)
}

struct RepeatFileInfo {
    file_name: OsString,
    size: u64,
}

#[cfg(target_os = "windows")]
fn get_platform_file_size(data: Metadata) -> u64 {
    data.file_size()
}

#[cfg(any(target_os = "linux", target_os = "android"))]
fn get_platform_file_size(data: Metadata) -> u64 {
    data.size()
}

#[cfg(target_os = "macos")]
fn get_platform_file_size(data: Metadata) -> u64 {
    data.st_size()
}

fn get_dir_all_files(folder: String) -> Vec<RepeatFileInfo> {
    let data = fs::read_dir(folder);
    let mut files = vec![];
    match data {
        Ok(paths) => {
            for path in paths {
                match path {
                    Ok(one_data) => {
                        let size = get_platform_file_size(one_data.metadata().unwrap());
                        let data = RepeatFileInfo {
                            file_name: one_data.file_name(),
                            size,
                        };
                        files.push(data);
                    }
                    _ => {}
                }
            }
        }
        _ => {}
    }
    files
}

const INDEX_FILE_NAME: &str = ".repeat_index";

fn touch_invisible_index_file(folder: String) -> Result<bool, Error> {
    let full_index_file_path = format!("{}/{}", folder, INDEX_FILE_NAME);
    let data = fs::metadata(&full_index_file_path);
    match data {
        Ok(full_data) => {
            println!("file exists");
        }
        Err(_) => {
            let _ = fs::File::create(&full_index_file_path)?;
        }
    }
    Ok(true)
}

#[derive(Debug)]
struct RepeatIndexItem {
    pub file_name: String,
    pub md5: String,
    pub size: u64,
}

fn get_repeat_index_data(folder: String) -> Vec<RepeatIndexItem> {
    vec![]
}

fn get_file_thumbnail(
    one_url: String,
    target_folder: String,
    longest_edge: u32,
) -> Result<bool, Error> {
    let img = image::open(&one_url).unwrap();
    let file_path = get_move_file_name(one_url, target_folder);

    img.resize(longest_edge, longest_edge, imageops::Triangle)
        .save(file_path)
        .unwrap();
    Ok(true)
}

fn get_move_file_name(file_name: String, folder: String) -> String {
    let file_sub_exp: Vec<&str> = file_name.split("/").collect();
    let file_path = format!("{}/{}", folder, file_sub_exp[file_sub_exp.len() - 1]);
    file_path
}

fn move_file(from: String, to: String) -> io::Result<()> {
    fs::rename(Path::new(&from), Path::new(&to))?;
    Ok(())
}

fn remove_repeat_file(remove_folder: String, url: String) -> io::Result<()> {
    let move_file_name = get_move_file_name(url.to_owned(), remove_folder);
    println!("move file name {}", move_file_name);
    move_file(url.to_owned(), move_file_name.to_owned())
}

#[cfg(test)]
mod tests {
    use crate::repeat::image::{
        get_dir_all_files, get_file_md5, get_file_thumbnail, get_move_file_name, is_file_same,
        remove_repeat_file, touch_invisible_index_file, ImageCheck, RepeatIndexItem,
        INDEX_FILE_NAME,
    };
    use std::fmt::format;

    #[test]
    fn test_get_file_md5() {
        println!("{}", get_file_md5(String::from("images/thumb/2.jpeg")));
        println!("{}", get_file_md5(String::from("images/thumb/3.jpeg")));
    }

    #[test]
    fn test_is_file_same() {
        println!(
            "{}",
            is_file_same(
                String::from("images/img/-6141127940323258510_121.jpg"),
                String::from("images/img/-6185836350851362884_121.jpg")
            )
        );
    }

    #[test]
    fn test_get_image_thumbnail() {
        get_file_thumbnail(
            String::from("images/img/-6185836350851362884_121.jpg"),
            String::from("images/thum"),
            64,
        );
        get_file_thumbnail(
            String::from("images/img/-6141127940323258510_121.jpg"),
            String::from("images/thum"),
            64,
        );
        println!(
            "{}",
            is_file_same(
                String::from("images/thum/-6141127940323258510_121.jpg"),
                String::from("images/thum/-6185836350851362884_121.jpg")
            )
        );
    }

    #[test]
    fn test_touch_inviable_file() {
        touch_invisible_index_file(String::from("images/img"));
    }

    #[test]
    fn test_handle_pic_repeat_by_md5() {
        let folder = r#"I:\tempv1\telvideo"#;
        let files = get_dir_all_files(String::from(folder));
        println!("{} total files", files.len());
        let mut list = vec![];
        for i in files {
            if !i.file_name.eq(INDEX_FILE_NAME) {
                let file_name =
                    String::from_utf8(i.file_name.to_ascii_lowercase().into_encoded_bytes())
                        .unwrap();
                let full_file_name = format!("{}/{}", folder, file_name);
                println!("{}", full_file_name);
                let md5 = get_file_md5(full_file_name.to_owned());
                let data = RepeatIndexItem {
                    file_name: full_file_name.to_owned(),
                    md5,
                    size: i.size,
                };
                list.push(data);
            }
        }
        let mut repeat_list = vec![];
        for i in 0..list.len() {
            let one_item = list.get(i).unwrap();
            let one_md5 = one_item.md5.to_owned();
            for j in i..list.len() {
                let two_item = list.get(j).unwrap();
                let two_md5 = two_item.md5.to_owned();
                if i != j {
                    if one_md5.eq(&two_md5) {
                        repeat_list.push(two_item);
                    }
                }
            }
        }
        for i in repeat_list {
            remove_repeat_file(String::from(r#"I:\tempv1\repeat"#), i.file_name.to_owned());
        }
    }

    #[test]
    fn test_get_move_file_name() {
        let folder = String::from("images/repeat_folder");
        println!(
            "{}",
            get_move_file_name(
                String::from("images/img/-6185836350851362884_121.jpg"),
                folder
            )
        )
    }

    #[test]
    fn test_handle_pic_repeat_by_thumbnail() {
        let thumbnail_folder = r#"images/thumb"#;
        let folder = r#"images/img"#;
        let files = get_dir_all_files(String::from(folder));
        println!("{} total files", files.len());
        for i in files {
            let file_name =
                String::from_utf8(i.file_name.to_ascii_lowercase().into_encoded_bytes()).unwrap();
            get_file_thumbnail(
                String::from(format!("{}/{}", folder, file_name)),
                thumbnail_folder.to_owned(),
                10,
            );
        }

        println!("{}", get_file_md5(String::from("images/thumb/2.jpeg")));
        println!("{}", get_file_md5(String::from("images/thumb/3.jpeg")));
        // let mut list = vec![];
        // for i in files {
        //     if !i.file_name.eq(INDEX_FILE_NAME) {
        //         let file_name = String::from_utf8(i.file_name.to_ascii_lowercase().into_encoded_bytes()).unwrap();
        //         let full_file_name = format!("{}/{}", folder, file_name);
        //         println!("{}", full_file_name);
        //         let md5 = get_file_md5(full_file_name.to_owned());
        //         let data = RepeatIndexItem{ file_name: full_file_name.to_owned(), md5,size:i.size };
        //         list.push(data);
        //     }
        // }
        // let mut repeat_list = vec![];
        // for i in 0..list.len() {
        //     let one_item = list.get(i).unwrap();
        //     let one_md5 = one_item.md5.to_owned();
        //     for j in i..list.len() {
        //         let two_item = list.get(j).unwrap();
        //         let two_md5 = two_item.md5.to_owned();
        //         if i != j {
        //             if one_md5.eq(&two_md5) {
        //                 repeat_list.push(two_item);
        //             }
        //         }
        //     }
        // }
        // for i in repeat_list {
        //     remove_repeat_file(String::from(r#"I:\tempv1\repeat"#),i.file_name.to_owned());
        // }
    }
}
