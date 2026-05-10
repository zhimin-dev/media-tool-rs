# media-tool-rs

一个处理媒体的常用工具

## usage

### 多个视频合并成一个

比如当前有2个视频`IMG_1767.MOV`以及`IMG_1768.MOV`，需要将这2个视频合并成一个视频，
你需要指定`-r IMG_(.*).MOV`并且指定开始的id(`--reg-file-start=`)以及结束的id(`--reg-file-end=`)
则执行下面的命令即可,会得到一个`IMG_.MOV`的合并后的视频文件。

```
media-tool-rs combine -r IMG_\(\.\*\).MOV --reg-file-start=1767 --reg-file-end=1768 --same_param_index=1 --target_file_name=2222.mp4
```

当然也可以指定生成后的文件名，需要跟上`--target_file_name=your_filename.MOV`


### 下载视频

```
media-tool-rs download --url=https://zmis.me/xxx.m3u8 --folder=1222
```

### 截取视频

-i 需要截取的视频

-s 视频开始的秒数

-d 截取视频的时长

```
media-tool-rs cut -i=/your/local/file.mp4 -s=5 -d=10
```

## Desktop (Tauri)

新增了 `desktop/` 桌面端：

- 支持按 `download / combine / cut` 创建任务并调用 CLI 执行
- 支持任务状态展示、按类型筛选、重试与删除（运行中任务禁止删除）
- 支持 m3u8 地址播放并可配置请求 Header
- 支持 m3u 地址解析，展示频道列表并选择播放

### 启动方式

```bash
cd desktop
npm install
npm run tauri dev
```

### CLI 可执行文件说明

桌面端优先按以下顺序查找并执行 CLI：

1. 环境变量 `MEDIA_TOOL_CLI` 指定的路径
2. `../target/debug/media-tool-rs`
3. 回退到 `cargo run --manifest-path ../Cargo.toml -- <args>`
