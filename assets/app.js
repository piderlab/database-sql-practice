let SQL;
let db;
let config;
let currentDatabase;
let lastResults = [];
let databaseDirty = false;
const APP_VERSION = "practice-1.0";

const DISPLAY_ROW_LIMIT = 1000;
const els = {
  siteTitle: document.getElementById("siteTitle"),
  siteSubtitle: document.getElementById("siteSubtitle"),
  stageBadge: document.getElementById("stageBadge"),
  status: document.getElementById("status"),
  dbTitle: document.getElementById("dbTitle"),
  dbDescription: document.getElementById("dbDescription"),
  dbSelect: document.getElementById("dbSelect"),
  dbSelectLabel: document.getElementById("dbSelectLabel"),
  diagram: document.getElementById("diagram"),
  tableList: document.getElementById("tableList"),
  editor: document.getElementById("sqlEditor"),
  result: document.getElementById("result"),
  message: document.getElementById("message"),
  timing: document.getElementById("timing"),
  schema: document.getElementById("schema"),
  dirty: document.getElementById("dirtyIndicator"),
  examples: document.getElementById("exampleSelect")
};

const examplesByDatabase = {
  exercise: [
    {
      id: "lecture",
      label: "lecture を表示",
      sql: `SELECT *
FROM lecture
ORDER BY id;`
    },
    {
      id: "teacher",
      label: "teacher を表示",
      sql: `SELECT *
FROM teacher
ORDER BY id;`
    },
    {
      id: "op_info",
      label: "op_info を表示",
      sql: `SELECT *
FROM op_info
ORDER BY id;`
    },
    {
      id: "lec_teacher",
      label: "lec_teacher を表示",
      sql: `SELECT *
FROM lec_teacher
ORDER BY id;`
    }
  ],

  piza: [
    {
      id: "ingredient",
      label: "ingredient を表示",
      sql: `SELECT *
FROM ingredient
ORDER BY id;`
    },
    {
      id: "quantity",
      label: "quantity を表示",
      sql: `SELECT *
FROM quantity
ORDER BY id;`
    },
    {
      id: "tree",
      label: "tree を表示",
      sql: `SELECT *
FROM tree
ORDER BY id;`
    }
  ]
};

function renderExamples(databaseId) {
  if (!els.examples) return;

  els.examples.innerHTML = "";

  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = "SQL例を選択...";
  els.examples.appendChild(placeholder);

  const examples = examplesByDatabase[databaseId] || [];
  examples.forEach(example => {
    const option = document.createElement("option");
    option.value = example.id;
    option.textContent = example.label;
    els.examples.appendChild(option);
  });
}

function getExample(databaseId, exampleId) {
  const examples = examplesByDatabase[databaseId] || [];
  return examples.find(example => example.id === exampleId);
}

async function initialise() {
  try {
    els.status.textContent = "SQLite準備中...";

    if (typeof initSqlJs !== "function") {
      throw new Error(
        "SQLiteライブラリを読み込めませんでした。埋め込みプレビューではなく、" +
        "ローカルHTTPサーバまたはGitHub Pagesから開いてください。"
      );
    }

    SQL = await initSqlJs({
      locateFile: file =>
        `https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.10.3/${file}`
    });

    const configResponse = await fetch("course-config.json", { cache: "no-store" });
    if (!configResponse.ok) throw new Error("course-config.json を読み込めません。");
    config = await configResponse.json();

    els.siteTitle.textContent = config.siteTitle || "データベース演習環境";
    els.siteSubtitle.textContent = config.subtitle || "";

    buildDatabaseSelector();

    if (!config.databases || config.databases.length === 0) {
      throw new Error("公開中のデータベースがありません。");
    }

    await loadDatabase(config.databases[0].id, true);
  } catch (error) {
    console.error(error);
    els.status.textContent = "初期化失敗";
    els.status.classList.add("error-status");
    els.message.innerHTML = `<span class="error">${escapeHtml(error.message)}</span>`;
  }
}

function buildDatabaseSelector() {
  els.dbSelect.innerHTML = "";
  config.databases.forEach(item => {
    const option = document.createElement("option");
    option.value = item.id;
    option.textContent = `${item.stage ? item.stage + "：" : ""}${item.title}`;
    els.dbSelect.appendChild(option);
  });

  const showSelector = config.databases.length > 1;
  els.dbSelect.hidden = !showSelector;
  els.dbSelectLabel.hidden = !showSelector;
}

async function loadDatabase(databaseId, setDefaultSql = false) {
  const item = config.databases.find(d => d.id === databaseId);
  if (!item) throw new Error("データベース設定が見つかりません。");

  els.status.textContent = "DB読み込み中...";
  els.status.classList.remove("ready", "error-status");

  const response = await fetch(`${item.file}?v=${encodeURIComponent(config.version || APP_VERSION)}`, { cache: "no-store" });
  if (!response.ok) throw new Error(`${item.file} を読み込めません。`);

  const bytes = new Uint8Array(await response.arrayBuffer());

  if (db) db.close();
  db = new SQL.Database(bytes);
  db.run("PRAGMA foreign_keys = ON;");

  currentDatabase = item;
  els.dbSelect.value = item.id;
  els.dbTitle.textContent = item.title;
  els.dbDescription.textContent = item.description || "";
  els.stageBadge.textContent = item.stage || "公開中";

  renderExamples(item.id);

  if (item.diagram) {
    els.diagram.src = `${item.diagram}?v=${encodeURIComponent(config.version || APP_VERSION)}`;
    els.diagram.hidden = false;
  } else {
    els.diagram.hidden = true;
  }

  // 新しいDBを読み込んだときは、SQLエディタを空にする。
  els.editor.value = "";

  els.result.innerHTML = "";
  els.timing.textContent = "";
  els.message.textContent = "準備完了。SQLを入力して「実行」を押してください。";
  els.status.textContent = "SQLite ready";
  els.status.classList.add("ready");
  databaseDirty = false;
  els.dirty.textContent = "";

  renderSchemaAndTables();
}

function executeSql() {
  if (!db) return;

  const sql = els.editor.value.trim();
  if (!sql) {
    els.message.textContent = "SQLを入力してください。";
    return;
  }

  const start = performance.now();

  try {
    lastResults = db.exec(sql);
    const elapsed = performance.now() - start;
    const changed = db.getRowsModified();
    const mutating = containsMutatingStatement(sql);

    renderResults(lastResults);

    if (lastResults.length > 0) {
      const total = lastResults.reduce((sum, r) => sum + r.values.length, 0);
      els.message.textContent =
        `実行成功：${lastResults.length} 個の結果セット，${total} 行`;
    } else {
      els.message.textContent =
        changed > 0
          ? `実行成功：${changed} 行が変更されました。`
          : "SQLは正常に実行されました。";
    }

    els.timing.textContent = `${elapsed.toFixed(1)} ms`;

    if (mutating) {
      databaseDirty = true;
    }
    els.dirty.textContent =
      databaseDirty ? "● DBは初期状態から変更されています" : "";

    renderSchemaAndTables();
  } catch (error) {
    lastResults = [];
    els.result.innerHTML = "";
    els.timing.textContent = "";
    els.message.innerHTML =
      `<span class="error">SQLite error: ${escapeHtml(error.message)}</span>`;
  }
}

function containsMutatingStatement(sql) {
  // コメントを除いて先頭キーワードを確認する簡易判定。
  // SELECT / WITH ... SELECT / EXPLAIN は変更扱いにしない。
  const cleaned = sql
    .replace(/--.*$/gm, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .trim();

  if (!cleaned) return false;

  // 授業で扱う主な更新・DDL文。
  return /\b(INSERT|UPDATE|DELETE|REPLACE|CREATE|DROP|ALTER|TRUNCATE|VACUUM|REINDEX|ANALYZE)\b/i.test(cleaned);
}

function renderResults(results) {
  els.result.innerHTML = "";

  if (results.length === 0) {
    const box = document.createElement("div");
    box.className = "success-box";
    box.textContent = "結果行を返さないSQLが正常に実行されました。";
    els.result.appendChild(box);
    return;
  }

  results.forEach((result, resultIndex) => {
    const wrapper = document.createElement("section");
    wrapper.className = "result-block";

    if (results.length > 1) {
      const heading = document.createElement("h3");
      heading.textContent = `Result ${resultIndex + 1}`;
      wrapper.appendChild(heading);
    }

    const tableWrap = document.createElement("div");
    tableWrap.className = "result-table-wrap";

    const table = document.createElement("table");
    table.className = "result-table";

    const thead = document.createElement("thead");
    const headerRow = document.createElement("tr");
    result.columns.forEach(column => {
      const th = document.createElement("th");
      th.textContent = column;
      headerRow.appendChild(th);
    });
    thead.appendChild(headerRow);
    table.appendChild(thead);

    const tbody = document.createElement("tbody");
    result.values.slice(0, DISPLAY_ROW_LIMIT).forEach(row => {
      const tr = document.createElement("tr");
      row.forEach(value => {
        const td = document.createElement("td");
        if (value === null) {
          td.textContent = "NULL";
          td.className = "null-value";
        } else {
          td.textContent = String(value);
        }
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    tableWrap.appendChild(table);
    wrapper.appendChild(tableWrap);

    const meta = document.createElement("div");
    meta.className = "result-meta";
    const shown = Math.min(result.values.length, DISPLAY_ROW_LIMIT);
    meta.textContent =
      result.values.length > DISPLAY_ROW_LIMIT
        ? `${shown} / ${result.values.length} rows shown`
        : `${result.values.length} row(s)`;
    wrapper.appendChild(meta);

    els.result.appendChild(wrapper);
  });
}

function getUserTables() {
  const r = db.exec(`
    SELECT name
    FROM sqlite_master
    WHERE type = 'table'
      AND name NOT LIKE 'sqlite_%'
    ORDER BY name;
  `);
  return r.length ? r[0].values.map(row => row[0]) : [];
}

function renderSchemaAndTables() {
  if (!db) return;

  const tables = getUserTables();
  els.tableList.innerHTML = "";
  els.schema.innerHTML = "";

  tables.forEach(tableName => {
    let count = "?";
    try {
      const r = db.exec(`SELECT COUNT(*) AS n FROM "${quoteIdent(tableName)}";`);
      count = r[0].values[0][0];
    } catch (_) {}

    const tableButton = document.createElement("button");
    tableButton.className = "table-item";
    tableButton.innerHTML =
      `<span class="table-name">${escapeHtml(tableName)}</span>` +
      `<span class="table-count">${count} rows</span>`;
    tableButton.addEventListener("click", () => {
      els.editor.value = `SELECT *\nFROM ${tableName}\nLIMIT 100;`;
      els.editor.focus();
      els.message.textContent =
        `${tableName} を参照するSQLをエディタに入力しました。「実行」を押してください。`;
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
    els.tableList.appendChild(tableButton);

    const info = db.exec(`PRAGMA table_info("${quoteIdent(tableName)}");`);
    const foreignKeys = db.exec(`PRAGMA foreign_key_list("${quoteIdent(tableName)}");`);

    const card = document.createElement("div");
    card.className = "schema-card";

    const title = document.createElement("div");
    title.className = "schema-card-title";
    title.innerHTML =
      `<code>${escapeHtml(tableName)}</code><span>${count} rows</span>`;
    card.appendChild(title);

    const columnList = document.createElement("div");
    columnList.className = "column-list";

    if (info.length) {
      info[0].values.forEach(row => {
        const [, name, type, notNull, defaultValue, pk] = row;
        const line = document.createElement("div");
        line.className = "column-row";
        line.innerHTML =
          `<code>${escapeHtml(name)}</code>` +
          `<span>${escapeHtml(type || "")}${pk ? " · PK" : ""}${notNull ? " · NOT NULL" : ""}</span>`;
        columnList.appendChild(line);
      });
    }

    card.appendChild(columnList);

    if (foreignKeys.length && foreignKeys[0].values.length) {
      const fkBox = document.createElement("div");
      fkBox.className = "fk-box";
      foreignKeys[0].values.forEach(row => {
        const referencedTable = row[2];
        const fromColumn = row[3];
        const toColumn = row[4];
        const p = document.createElement("div");
        p.innerHTML =
          `<code>${escapeHtml(fromColumn)}</code> → ` +
          `<code>${escapeHtml(referencedTable)}.${escapeHtml(toColumn)}</code>`;
        fkBox.appendChild(p);
      });
      card.appendChild(fkBox);
    }

    els.schema.appendChild(card);
  });
}

async function resetDatabase() {
  if (!currentDatabase) return;
  const ok = confirm("データベースを配布時の初期状態に戻しますか？");
  if (!ok) return;

  await loadDatabase(currentDatabase.id, false);
  els.editor.value = "";
  els.message.textContent = "データベースを初期状態に戻しました。";
}

function saveSql() {
  const filename = `${currentDatabase ? currentDatabase.id : "exercise"}-answer.sql`;
  downloadBlob(
    new Blob([els.editor.value], { type: "text/sql;charset=utf-8" }),
    filename
  );
}


function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}


function quoteIdent(value) {
  return String(value).replaceAll('"', '""');
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function bindEvent(id, eventName, handler) {
  const element = document.getElementById(id);
  if (!element) {
    console.warn(`SQL Lab: element #${id} was not found; handler was skipped.`);
    return;
  }
  element.addEventListener(eventName, handler);
}

bindEvent("runBtn", "click", executeSql);
bindEvent("resetBtn", "click", resetDatabase);
bindEvent("saveSqlBtn", "click", saveSql);

if (els.dbSelect) {
  els.dbSelect.addEventListener("change", async event => {
    await loadDatabase(event.target.value, true);
  });
}

if (els.examples) {
  els.examples.addEventListener("change", event => {
    const example = getExample(
      currentDatabase ? currentDatabase.id : "",
      event.target.value
    );
    if (example) {
      els.editor.value = example.sql;
      els.editor.focus();
    }
    event.target.value = "";
  });
}

if (els.editor) {
  els.editor.addEventListener("keydown", event => {
    if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
      event.preventDefault();
      executeSql();
    }
    if (event.key === "Tab") {
      event.preventDefault();
      const start = els.editor.selectionStart;
      const end = els.editor.selectionEnd;
      els.editor.setRangeText("  ", start, end, "end");
    }
  });
}

console.info(`Database Exercise SQL Lab ${APP_VERSION}`);
initialise();
