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

如果下载需要请求头，可以通过 JSON 字符串传入：

```bash
media-tool-rs download --url=https://zmis.me/xxx.m3u8 --header='{"referer":"https://zmis.me","origin":"https://zmis.me"}'
```

下载输出目录默认在 `static/download/<folder>/`。

### 截取视频

-i 需要截取的视频

-s 视频开始的秒数

-d 截取视频的时长

```
media-tool-rs cut -i=/your/local/file.mp4 -s=5 -d=10
```

截取输出目录默认在 `static/cut/`。

## 可视化界面

项目新增了一个 React + Material UI 前端，目录在 `/tmp/workspace/zhimin-dev/media-tool-rs/desktop`。

### 1. 启动后端接口

在项目根目录执行：

```bash
cargo run -- serve --port=8080
```

这会启动可视化界面所需的任务接口，支持：

- 新建下载、合并、截取任务
- 查询任务状态和最终输出路径
- 顺序执行任务，避免下载时目录切换冲突
- 自动托管 `./static` 目录，可直接访问 `http://127.0.0.1:8080/static/download/<folder>/<file>.mp4`
- Header 预设配置文件保存在 `config/header_presets.json`

### 2. 启动 React 前端

```bash
cd desktop
npm install
npm run dev
# 或者使用 npm run tauri dev
```

默认开发地址是 `http://127.0.0.1:5173`，Vite 已代理 `/api` 到 `http://127.0.0.1:8080`。

如果使用 `npm run tauri dev`：

- 请确保在 `desktop` 目录执行命令；
- 首次运行会编译 `desktop/src-tauri`（已初始化）；
- Linux 需要先安装 GTK/WebKit 相关系统依赖（例如 `glib-2.0`、`webkit2gtk`、`libsoup3` 等），否则会出现 `glib-2.0.pc not found` 之类报错。

### 3. 前端能力

- 可视化创建 `download` / `combine` / `cut` 任务
- 实时查看任务状态、命令预览和输出结果
- 支持在线播放 m3u8 链接
- 适合在 macOS、Windows 上运行
