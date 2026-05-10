const { invoke } = window.__TAURI__.core;

const $ = (id) => document.getElementById(id);
const state = {
  filter: "all",
  headers: [],
  hls: null,
};

const feedbackEl = $("feedback");
const tasksEl = $("tasks");
const channelListEl = $("channel-list");
const playlistInfoEl = $("playlist-info");
const playerEl = $("player");

function setFeedback(message, isError = false) {
  feedbackEl.textContent = message;
  feedbackEl.className = isError ? "error" : "";
}

function formParams() {
  const taskType = $("task-type").value;

  if (taskType === "download") {
    return {
      taskType,
      params: {
        url: $("download-url").value.trim(),
        folder: $("download-folder").value.trim(),
        target_file_name: $("download-target").value.trim(),
        concurrent: Number($("download-concurrent").value || 10),
        ffmpeg_download: $("download-ffmpeg").checked,
      },
    };
  }

  if (taskType === "combine") {
    return {
      taskType,
      params: {
        reg_name: $("combine-reg-name").value.trim(),
        reg_file_start: Number($("combine-start").value),
        reg_file_end: Number($("combine-end").value),
        target_file_name: $("combine-target").value.trim(),
        same_param_index: Number($("combine-same-index").value || -1),
      },
    };
  }

  return {
    taskType,
    params: {
      input: $("cut-input").value.trim(),
      start: Number($("cut-start").value || 0),
      duration: Number($("cut-duration").value || 3),
      target_file_name: $("cut-target").value.trim(),
    },
  };
}

function updateTaskForm() {
  const taskType = $("task-type").value;
  for (const id of ["download-form", "combine-form", "cut-form"]) {
    $(id).classList.add("hidden");
  }
  $(`${taskType}-form`).classList.remove("hidden");
}

function maskHeaders(headers) {
  return headers.map((item) => {
    const key = item.key.trim().toLowerCase();
    const isSensitive = ["authorization", "token", "cookie"].some((segment) => key.includes(segment));
    return {
      key: item.key,
      value: isSensitive && item.value ? "***" : item.value,
    };
  });
}

function renderHeaderRows() {
  const list = $("header-list");
  list.innerHTML = "";

  state.headers.forEach((header, index) => {
    const row = document.createElement("div");
    row.className = "row two-col header-row";

    const keyInput = document.createElement("input");
    keyInput.placeholder = "Header-Key";
    keyInput.value = header.key;
    keyInput.addEventListener("input", (e) => {
      state.headers[index].key = e.target.value;
    });

    const valueInput = document.createElement("input");
    valueInput.placeholder = "Header-Value";
    valueInput.value = header.value;
    valueInput.addEventListener("input", (e) => {
      state.headers[index].value = e.target.value;
    });

    const delBtn = document.createElement("button");
    delBtn.textContent = "删除";
    delBtn.addEventListener("click", () => {
      state.headers.splice(index, 1);
      renderHeaderRows();
    });

    row.appendChild(keyInput);
    row.appendChild(valueInput);
    row.appendChild(delBtn);
    list.appendChild(row);
  });
}

function buildHeaderObject() {
  const headers = {};
  state.headers.forEach((item) => {
    const key = item.key.trim();
    const value = item.value.trim();
    if (key) {
      headers[key] = value;
    }
  });
  return headers;
}

function stopPlayback() {
  if (state.hls) {
    state.hls.destroy();
    state.hls = null;
  }
  playerEl.pause();
  playerEl.removeAttribute("src");
  playerEl.load();
}

function playUrl(url) {
  stopPlayback();

  const headers = buildHeaderObject();
  const masked = maskHeaders(state.headers);

  if (window.Hls && window.Hls.isSupported()) {
    const hls = new window.Hls({
      xhrSetup: (xhr) => {
        Object.entries(headers).forEach(([key, value]) => xhr.setRequestHeader(key, value));
      },
    });
    hls.loadSource(url);
    hls.attachMedia(playerEl);
    state.hls = hls;
  } else {
    playerEl.src = url;
  }

  playerEl
    .play()
    .then(() => {
      setFeedback(`开始播放: ${url}\nheaders: ${JSON.stringify(masked)}`);
    })
    .catch((err) => {
      setFeedback(`播放失败: ${err}`, true);
    });
}

function taskBadge(task) {
  return `<span class="badge ${task.status}">${task.status}</span>`;
}

async function refreshTasks() {
  const taskType = state.filter === "all" ? null : state.filter;
  const tasks = await invoke("list_tasks", { taskType });
  tasksEl.innerHTML = "";

  if (!tasks.length) {
    tasksEl.innerHTML = "<p>暂无任务</p>";
    return;
  }

  tasks.forEach((task) => {
    const item = document.createElement("article");
    item.className = "task-item";

    const params = { ...task.params };
    if (params.headers) {
      params.headers = "***";
    }

    item.innerHTML = `
      <div class="row between">
        <strong>#${task.id} ${task.task_type}</strong>
        ${taskBadge(task)}
      </div>
      <div class="meta">retry: ${task.retry_count} | updated: ${new Date(task.updated_at * 1000).toLocaleString()}</div>
      <div class="meta">params: ${JSON.stringify(params)}</div>
      <div class="meta">command: ${task.command_display || "-"}</div>
      <div class="meta">result: ${task.result_path || "-"}</div>
      <details><summary>日志</summary><pre>${task.logs || "(空)"}</pre></details>
      ${task.error ? `<div class="error">${task.error}</div>` : ""}
      <div class="row">
        <button data-action="retry">重试</button>
        <button data-action="delete">删除</button>
      </div>
    `;

    item.querySelector('[data-action="retry"]').addEventListener("click", async () => {
      try {
        await invoke("retry_task", { taskId: task.id });
        setFeedback(`任务 ${task.id} 已重试`);
        await refreshTasks();
      } catch (error) {
        setFeedback(String(error), true);
      }
    });

    item.querySelector('[data-action="delete"]').addEventListener("click", async () => {
      try {
        await invoke("delete_task", { taskId: task.id });
        setFeedback(`任务 ${task.id} 已删除`);
        await refreshTasks();
      } catch (error) {
        setFeedback(String(error), true);
      }
    });

    tasksEl.appendChild(item);
  });
}

async function parsePlaylist() {
  const url = $("player-url").value.trim();
  if (!url) {
    setFeedback("请输入播放地址", true);
    return;
  }

  try {
    const data = await invoke("parse_playlist", {
      request: {
        url,
        headers: state.headers.filter((item) => item.key.trim()),
      },
    });

    playlistInfoEl.textContent = `类型: ${data.kind}`;
    channelListEl.innerHTML = "";

    if (data.kind === "m3u") {
      if (!data.channels.length) {
        channelListEl.innerHTML = "<p>未解析到频道</p>";
        return;
      }

      data.channels.forEach((channel) => {
        const row = document.createElement("div");
        row.className = "channel-item";
        row.innerHTML = `<span>[${channel.group}] ${channel.name}</span><button>播放</button>`;
        row.querySelector("button").addEventListener("click", () => {
          $("player-url").value = channel.url;
          playUrl(channel.url);
        });
        channelListEl.appendChild(row);
      });
      return;
    }

    if (data.m3u8?.is_master && data.m3u8.variants?.length) {
      data.m3u8.variants.forEach((variant) => {
        const row = document.createElement("div");
        row.className = "channel-item";
        row.innerHTML = `<span>${variant.name} ${variant.resolution || ""} ${variant.bandwidth || ""}</span><button>播放</button>`;
        row.querySelector("button").addEventListener("click", () => {
          $("player-url").value = variant.url;
          playUrl(variant.url);
        });
        channelListEl.appendChild(row);
      });
    }
  } catch (error) {
    setFeedback(String(error), true);
  }
}

window.addEventListener("DOMContentLoaded", async () => {
  $("task-type").addEventListener("change", updateTaskForm);
  updateTaskForm();

  $("create-task").addEventListener("click", async () => {
    try {
      const payload = formParams();
      await invoke("create_task", {
        input: { task_type: payload.taskType, params: payload.params },
      });
      setFeedback(`已创建任务: ${payload.taskType}`);
      await refreshTasks();
    } catch (error) {
      setFeedback(String(error), true);
    }
  });

  document.querySelectorAll("#task-tabs button").forEach((button) => {
    button.addEventListener("click", async () => {
      document.querySelectorAll("#task-tabs button").forEach((el) => el.classList.remove("active"));
      button.classList.add("active");
      state.filter = button.dataset.type;
      await refreshTasks();
    });
  });

  $("add-header").addEventListener("click", () => {
    state.headers.push({ key: "", value: "" });
    renderHeaderRows();
  });

  $("parse-playlist").addEventListener("click", parsePlaylist);
  $("play-url").addEventListener("click", () => {
    const url = $("player-url").value.trim();
    if (!url) {
      setFeedback("请输入播放地址", true);
      return;
    }
    playUrl(url);
  });

  state.headers = [{ key: "User-Agent", value: "Mozilla/5.0" }];
  renderHeaderRows();
  await refreshTasks();

  setInterval(refreshTasks, 4000);
});
