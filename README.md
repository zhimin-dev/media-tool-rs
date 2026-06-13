# Media Tool

一个多功能视频处理工具箱。无需安装复杂软件，下载、合并、剪辑、转码一站式搞定。

![Media Tool Icon](desktop/src-tauri/icons/icon.png)

---

## 能做什么？

### 📥 视频下载

粘贴 m3u8 视频链接，一键下载整部视频。支持：

- 普通 m3u8 和加密 m3u8（AES-128 / SAMPLE-AES）
- 多线程并发下载，速度更快
- 自定义请求头，应对需要登录或 Referer 验证的视频源
- 下载后自动合并为 mp4

### 🔗 视频合并

把多个视频片段拼接成一个完整视频。支持：

- 按顺序批量合并多个 mp4 文件
- 正则匹配批量导入（如 `video_01.mp4` ~ `video_20.mp4`）
- 合并时可调整分辨率、帧率、码率

### ✂️ 视频截取

从长视频中截取精彩片段。只需设置起始时间和持续时长，秒出结果。

### 🔄 视频转码

将视频转换为不同格式或画质。支持自定义：

- 视频编码（H.264 / H.265）
- 分辨率（4K / 1080p / 720p 等）
- 码率、帧率
- 音频编码（AAC / MP3 / Opus）、音频码率、声道、采样率

### 📺 在线播放

内置视频播放器，直接输入 m3u8 链接在线观看，粘贴即播。

### 🖥️ 桌面应用

提供 macOS / Windows / Linux 桌面客户端，图形化操作，无需敲命令。

![操作流程图](https://mermaid.ink/img/pako:eNp1kcFOwkAQhl-l2bMaSikUPJjoxYMXDXoyHrbLQDct3ZrdNSGEd7fVEhGCp3Y6_3z_zPyNs0XjYcLcMO38nRWtQ8aRhKXCHQXjGNzKWnWk3qOylF0UpCg-0e_EsZDHl19GPkMHMk4s-qNjP7C6jSZdEWbHd4VqHe6KPhQBH3SYmUjF92SOpg1zaI02H7vKa62iqggozjmmCgO92UJDaSYm0pnMcRLnS5EVhbiW1bwoxVrKclUkDl2l1T0HqDozKuy_bkC_a4pDp23PngKZJcU3Ctu2sfT89uNdjDm6fMJZ2RZ3bvtBzYHee6iDMsPpDMYj6B6w2zx4qgbkLZbunrQFHOGEbz2Hl1YI_ocw57dkdG_19tO3OD1FmNMjigSTpGAhIeGBxYEnMYko4jKhlESmJBpxwjn7e1xMIWYUE5LLuWSXzN12fwG61f7G)

---

## 两种使用方式

### 🎯 桌面应用（推荐）

下载对应平台的安装包，开箱即用。界面美观，任务可视化，实时查看下载/处理进度。

- **macOS**：`.dmg` 安装包
- **Windows**：`.msi` / `.exe` 安装包
- **Linux**：`.AppImage` / `.deb` 安装包

安装包可在 [GitHub Releases](https://github.com/zmisgod/media-tool-rs/releases) 页面下载。

### ⌨️ 命令行

也支持直接在终端中使用：

```bash
# 下载视频
media-tool-rs download --url "https://example.com/video.m3u8"

# 合并视频
media-tool-rs combine --reg-name "clip_(.*).mp4" --reg-name-start 1 --reg-name-end 10

# 截取片段
media-tool-rs cut --input "video.mp4" --start 30 --duration 60

# 转码视频
media-tool-rs transcode --input "video.mp4" --video-codec h265 --resolution 1080p

# 启动 Web 服务（配合前端界面使用）
media-tool-rs serve --port 8080
```

---

## 开发相关

本项目使用 Rust 编写核心逻辑，前端基于 React + Material UI + Tauri 构建桌面应用。

如需从源码运行，请确保已安装 Rust 和 Node.js，然后：

```bash
# 启动后端服务
cargo run -- serve --port=0

# 启动前端开发服务器（另一个终端）
cd desktop
npm install
npm run dev:with-server
```

`npm run dev:with-server` 会自动启动后端并配置好代理，打开浏览器即可使用。

如需构建桌面安装包：

```bash
cd desktop
npm run tauri build
```

> Linux 用户需先安装 GTK / WebKit 等系统依赖。

---

## 许可

MIT License
