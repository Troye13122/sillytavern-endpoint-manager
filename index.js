/**
 * 端点收藏夹 (Custom Endpoint Manager)
 *
 * 多 URL + 多 Key 管理：
 * - 每个端点有自定义名称、Base URL、可选模型；
 * - 每个端点可绑定多把 key；
 * - 在「Custom Endpoint」和「Custom API Key」输入框下方提供快捷下拉；
 * - key 本身仍保存在 ST 的 secrets.json，本扩展只保存 secretId / label / masked value。
 */

import { extension_settings } from '../../../extensions.js';
import { saveSettingsDebounced, eventSource, event_types } from '../../../../script.js';
import {
    SECRET_KEYS,
    secret_state,
    readSecretState,
    writeSecret,
    rotateSecret,
} from '../../../secrets.js';

const MODULE_NAME = 'custom_endpoint_manager';
const DEFAULT_SETTINGS = {
    profiles: [],
    activeProfileId: null,
    autoConnect: true,
};

const SEL = {
    url: '#custom_api_url_text',
    key: '#api_key_custom',
    model: '#custom_model_id',
    source: '#chat_completion_source',
    connect: '#api_button_openai',
};

let managerProfileId = null;
let managerDraft = null;
let keyDialogProfileId = null;
let importProfileId = null;
let newDialogFromManager = false;

/* ------------------------------------------------------------------ */
/* 基础工具                                                           */
/* ------------------------------------------------------------------ */

function toast(type, msg) {
    try {
        if (window.toastr && typeof toastr[type] === 'function') {
            toastr[type](msg);
        } else {
            console.log(`[端点收藏夹] ${msg}`);
        }
    } catch {
        console.log(`[端点收藏夹] ${msg}`);
    }
}

function uid() {
    try {
        if (window.crypto?.randomUUID) return crypto.randomUUID();
    } catch { /* ignore */ }
    return `cem-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function clone(obj) {
    return JSON.parse(JSON.stringify(obj ?? {}));
}

function esc(value) {
    return String(value ?? '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;');
}

function normUrl(value) {
    return String(value ?? '').trim().replace(/\/+$/u, '');
}

function shortUrl(value) {
    return String(value ?? '')
        .replace(/^https?:\/\//iu, '')
        .replace(/\/+$/u, '')
        .slice(0, 48);
}

function defaultName(url) {
    try {
        return new URL(url).hostname || '新端点';
    } catch {
        const host = String(url ?? '').replace(/^https?:\/\//iu, '').split('/')[0];
        return host || '新端点';
    }
}

function maskTail(value) {
    const text = String(value ?? '');
    if (text.length <= 8) return '…';
    return `${text.slice(0, 3)}…${text.slice(-4)}`;
}

/* ------------------------------------------------------------------ */
/* 设置与数据                                                         */
/* ------------------------------------------------------------------ */

function getSettings() {
    if (!extension_settings[MODULE_NAME] || typeof extension_settings[MODULE_NAME] !== 'object') {
        extension_settings[MODULE_NAME] = clone(DEFAULT_SETTINGS);
    }
    const settings = extension_settings[MODULE_NAME];
    if (!Array.isArray(settings.profiles)) settings.profiles = [];
    if (typeof settings.autoConnect !== 'boolean') settings.autoConnect = true;
    if (settings.activeProfileId === undefined) settings.activeProfileId = null;

    for (const profile of settings.profiles) {
        if (!profile.id) profile.id = uid();
        if (!Array.isArray(profile.keys)) profile.keys = [];
        if (!profile.name) profile.name = '未命名端点';
        if (!profile.url) profile.url = '';
        if (!profile.model) profile.model = '';
        for (const key of profile.keys) {
            if (!key.id) key.id = uid();
            if (!key.label) key.label = 'key';
            if (!key.masked) key.masked = '';
        }
    }
    return settings;
}

function save() {
    saveSettingsDebounced();
}

function getProfiles() {
    return getSettings().profiles;
}

function getProfile(id) {
    if (!id) return null;
    return getProfiles().find(profile => profile.id === id) || null;
}

function getSecretEntries() {
    const entries = secret_state?.[SECRET_KEYS.CUSTOM];
    return Array.isArray(entries) ? entries : [];
}

function getActiveSecret() {
    return getSecretEntries().find(entry => entry.active) || null;
}

function keyLabel(key) {
    return `${key.label || 'key'}${key.masked ? ` · ${key.masked}` : ''}`;
}

function currentUrl() {
    return String($(SEL.url).val() ?? '').trim();
}

function currentModel() {
    return String($(SEL.model).val() ?? '').trim();
}

function currentProfile() {
    const settings = getSettings();
    const url = currentUrl();
    if (!url) return null;
    const active = getProfile(settings.activeProfileId);
    if (active && normUrl(active.url) === normUrl(url)) return active;
    return getProfiles().find(profile => normUrl(profile.url) === normUrl(url)) || null;
}

function isCustomSource() {
    return String($(SEL.source).val() ?? '') === 'custom';
}

/* ------------------------------------------------------------------ */
/* 应用端点 / key                                                     */
/* ------------------------------------------------------------------ */

function setUrl(url) {
    $(SEL.url).val(url).trigger('input');
}

function setModel(model) {
    $(SEL.model).val(model).trigger('input');
}

async function activateKey(key) {
    if (!key?.secretId) return false;
    const entry = getSecretEntries().find(item => item.id === key.secretId);
    if (!entry) return false;
    if (!entry.active) {
        await rotateSecret(SECRET_KEYS.CUSTOM, key.secretId);
    }
    // 防止输入框里残留旧 key，Connect 时被再次写入
    $(SEL.key).val('').trigger('input');
    return true;
}

async function applyProfile(profile, { connect = true } = {}) {
    if (!profile) return;
    if (!String(profile.url ?? '').trim()) {
        toast('warning', '这个端点还没有填写 Base URL');
        return;
    }

    setUrl(profile.url);
    if (profile.model) setModel(profile.model);

    const key = profile.keys.find(item => item.id === profile.activeKeyId) || profile.keys[0] || null;
    if (key) {
        const ok = await activateKey(key);
        if (!ok) {
            toast('error', `key「${key.label || ''}」在酒馆里已不存在，请在端点收藏夹里重新添加`);
        }
    }

    const settings = getSettings();
    settings.activeProfileId = profile.id;
    if (key) profile.activeKeyId = key.id;
    save();
    refreshInline();
    renderManager();

    if (connect && settings.autoConnect && isCustomSource()) {
        setTimeout(() => $(SEL.connect).trigger('click'), 60);
    }

    toast('success', `已切换到「${profile.name}」${key ? ` / ${keyLabel(key)}` : ''}`);
}

function ensureNewProfileDialog() {
    if (document.querySelector('#cem-new-dialog')) return;
    $('body').append(`
        <dialog id="cem-new-dialog" class="cem-dialog cem-small-dialog">
            <div class="cem-dialog-title" id="cem-new-title">新建端点</div>
            <div class="cem-new-body">
                <label class="cem-field">
                    <span>名称</span>
                    <input id="cem-new-name" class="text_pole" placeholder="例如：北棱改文站">
                </label>
                <label class="cem-field">
                    <span>Base URL</span>
                    <input id="cem-new-url" class="text_pole" placeholder="https://.../v1">
                </label>
                <label class="cem-field">
                    <span>模型（可选）</span>
                    <input id="cem-new-model" class="text_pole" placeholder="deepseek-flash/rewrite3-27B">
                </label>
                <label class="checkbox_label" id="cem-new-bind-row">
                    <input id="cem-new-bind" type="checkbox">
                    <span>同时绑定当前酒馆 key</span>
                </label>
                <div class="cem-dialog-actions cem-dialog-actions-right">
                    <button id="cem-new-create" class="menu_button">创建</button>
                    <button id="cem-new-cancel" class="menu_button">取消</button>
                </div>
            </div>
        </dialog>
    `);
}

function updateNewBindRow() {
    const current = currentUrl();
    const url = String($('#cem-new-url').val() ?? '').trim();
    const hasActive = Boolean(getActiveSecret());
    const show = hasActive && normUrl(url) !== '' && normUrl(url) === normUrl(current);
    $('#cem-new-bind-row').toggle(show);
    if (!show) $('#cem-new-bind').prop('checked', false);
}

function openNewProfileDialog({ prefill = true, fromManager = false } = {}) {
    ensureNewProfileDialog();
    newDialogFromManager = fromManager;
    const current = currentUrl();
    const active = getActiveSecret();

    $('#cem-new-title').text(fromManager ? '新建端点' : '保存当前端点');
    $('#cem-new-name').val(prefill ? (current ? defaultName(current) : '') : '');
    $('#cem-new-url').val(prefill ? current : '');
    $('#cem-new-model').val(prefill ? currentModel() : '');
    $('#cem-new-bind').prop('checked', Boolean(active && prefill && current));
    updateNewBindRow();

    const dialog = document.querySelector('#cem-new-dialog');
    if (dialog && !dialog.open) dialog.showModal();
    setTimeout(() => $('#cem-new-name').trigger('focus').trigger('select'), 50);
}

function createNewProfile() {
    const name = String($('#cem-new-name').val() ?? '').trim();
    const url = String($('#cem-new-url').val() ?? '').trim();
    const model = String($('#cem-new-model').val() ?? '').trim();
    if (!name) {
        toast('warning', '先给端点起个名字');
        $('#cem-new-name').trigger('focus');
        return;
    }

    const profile = {
        id: uid(),
        name,
        url,
        model,
        keys: [],
        activeKeyId: null,
    };

    const bind = $('#cem-new-bind-row').is(':visible') && $('#cem-new-bind').prop('checked');
    const active = getActiveSecret();
    if (bind && active) {
        const key = {
            id: uid(),
            secretId: active.id,
            label: active.label || '当前 key',
            masked: active.value || '',
        };
        profile.keys.push(key);
        profile.activeKeyId = key.id;
    }

    getSettings().profiles.push(profile);
    if (url && normUrl(url) === normUrl(currentUrl())) {
        getSettings().activeProfileId = profile.id;
    }
    save();
    closeDialog('#cem-new-dialog');
    refreshInline();

    if (newDialogFromManager) {
        managerProfileId = profile.id;
        managerDraft = clone(profile);
        renderManager();
    }

    toast('success', `端点「${name}」已创建`);
}

/* ------------------------------------------------------------------ */
/* 内联 UI                                                            */
/* ------------------------------------------------------------------ */

function injectInlineBars() {
    const urlInput = document.querySelector(SEL.url);
    if (!urlInput) return false;

    if (!document.querySelector('#cem-url-bar')) {
        const urlBar = $(`
            <div id="cem-url-bar" class="cem-bar">
                <select id="cem-profile-select" class="text_pole cem-select" title="选择收藏的端点"></select>
                <div id="cem-save-profile" class="menu_button menu_button_icon cem-icon-btn" title="把当前端点保存到收藏夹">
                    <i class="fa-solid fa-plus"></i>
                </div>
                <div id="cem-open-manager" class="menu_button menu_button_icon cem-icon-btn" title="管理端点">
                    <i class="fa-solid fa-gear"></i>
                </div>
            </div>
        `);
        $(urlInput).closest('.flex-container').after(urlBar);
    }

    if (!document.querySelector('#cem-key-bar')) {
        const keyBar = $(`
            <div id="cem-key-bar" class="cem-bar">
                <select id="cem-key-select" class="text_pole cem-select" title="选择该端点绑定的 key"></select>
                <div id="cem-add-key" class="menu_button menu_button_icon cem-icon-btn" title="给当前端点添加 key">
                    <i class="fa-solid fa-plus"></i>
                </div>
            </div>
        `);
        $(SEL.key).closest('.flex-container').after(keyBar);
    }

    return true;
}

function refreshInline() {
    const profiles = getProfiles();
    const profile = currentProfile();
    const url = currentUrl();

    const $profileSelect = $('#cem-profile-select');
    let profileOptions = '<option value="">— 选择收藏端点 —</option>';
    for (const item of profiles) {
        const label = `${item.name}${item.url ? ` · ${shortUrl(item.url)}` : ''}`;
        profileOptions += `<option value="${esc(item.id)}">${esc(label)}</option>`;
    }
    if (!profiles.length) {
        profileOptions = '<option value="">（暂无收藏端点，点 + 保存当前）</option>';
    }
    $profileSelect.html(profileOptions);
    if (profile) {
        $profileSelect.val(profile.id);
    } else if (!url) {
        $profileSelect.val('');
    } else {
        $profileSelect.val('');
    }

    const $keySelect = $('#cem-key-select');
    if (!profile) {
        $keySelect.html('<option value="">（先保存端点）</option>').prop('disabled', true);
        $('#cem-add-key').addClass('cem-disabled');
        return;
    }

    const activeSecret = getActiveSecret();
    let keyOptions = '<option value="">— 选择 key —</option>';
    for (const key of profile.keys) {
        const isActive = Boolean(activeSecret && activeSecret.id === key.secretId);
        keyOptions += `<option value="${esc(key.id)}">${isActive ? '✓ ' : ''}${esc(keyLabel(key))}</option>`;
    }
    if (!profile.keys.length) {
        keyOptions = '<option value="">（该端点还没有 key）</option>';
    }
    $keySelect.html(keyOptions).prop('disabled', !profile.keys.length);

    const selected = profile.keys.find(key => key.id === profile.activeKeyId)
        || profile.keys.find(key => activeSecret && key.secretId === activeSecret.id)
        || null;
    if (selected) $keySelect.val(selected.id);

    $('#cem-add-key').removeClass('cem-disabled');
}

/* ------------------------------------------------------------------ */
/* 管理弹窗                                                           */
/* ------------------------------------------------------------------ */

function ensureManagerDialog() {
    if (document.querySelector('#cem-dialog')) return;
    $('body').append(`
        <dialog id="cem-dialog" class="cem-dialog">
            <div class="cem-dialog-head">
                <div class="cem-dialog-title">端点收藏夹</div>
                <div class="cem-dialog-actions">
                    <button id="cem-new-profile" class="menu_button">＋ 新建</button>
                    <button id="cem-import-current" class="menu_button">导入当前</button>
                    <button id="cem-close" class="menu_button">关闭</button>
                </div>
            </div>
            <div class="cem-dialog-body">
                <div class="cem-side">
                    <input id="cem-search" class="text_pole" placeholder="搜索名称或 URL">
                    <div id="cem-profile-list" class="cem-profile-list"></div>
                </div>
                <div id="cem-editor" class="cem-editor"></div>
            </div>
        </dialog>
    `);
}

function openManager(profileId = null) {
    ensureManagerDialog();
    const settings = getSettings();
    if (profileId && getProfile(profileId)) {
        managerProfileId = profileId;
    } else if (!getProfile(managerProfileId)) {
        managerProfileId = settings.activeProfileId || getProfiles()[0]?.id || null;
    }
    managerDraft = null;
    renderManager();

    const dialog = document.querySelector('#cem-dialog');
    if (dialog && !dialog.open) {
        dialog.showModal();
    }
}

function renderManager() {
    ensureManagerDialog();
    const settings = getSettings();
    const profiles = getProfiles();
    const filter = String($('#cem-search').val() ?? '').trim().toLowerCase();

    if (!getProfile(managerProfileId)) {
        managerProfileId = settings.activeProfileId || profiles[0]?.id || null;
        managerDraft = null;
    }

    const $list = $('#cem-profile-list').empty();
    if (!profiles.length) {
        $list.html('<div class="cem-empty">还没有收藏端点。<br>点右上角「导入当前」把当前 URL 存进来。</div>');
        $('#cem-editor').html('<div class="cem-empty">选择一个端点，或新建一个。</div>');
        return;
    }

    const current = currentProfile();
    const shown = profiles.filter(profile => {
        if (!filter) return true;
        return `${profile.name} ${profile.url}`.toLowerCase().includes(filter);
    });

    for (const profile of shown) {
        const isCurrent = current && current.id === profile.id;
        const selected = profile.id === managerProfileId;
        $list.append(`
            <div class="cem-profile-item${selected ? ' is-selected' : ''}" data-id="${esc(profile.id)}">
                <div class="cem-profile-name">${esc(profile.name || '未命名端点')}</div>
                <div class="cem-profile-url">${esc(shortUrl(profile.url) || '（未填 URL）')}</div>
                <div class="cem-profile-meta">${profile.keys.length} 个 key${isCurrent ? ' · 当前' : ''}</div>
            </div>
        `);
    }

    if (!shown.length) {
        $list.html('<div class="cem-empty">没有匹配的端点。</div>');
    }

    renderEditor();
}

function renderEditor() {
    const profile = getProfile(managerProfileId);
    if (!profile) {
        $('#cem-editor').html('<div class="cem-empty">选择一个端点，或新建一个。</div>');
        return;
    }

    const draft = managerDraft && managerDraft.id === profile.id ? managerDraft : clone(profile);
    managerDraft = draft;
    const activeSecret = getActiveSecret();

    const keyRows = profile.keys.map(key => {
        const isActive = Boolean(activeSecret && activeSecret.id === key.secretId);
        const isDefault = profile.activeKeyId === key.id;
        return `
            <div class="cem-key-row" data-id="${esc(key.id)}">
                <div class="cem-key-main">
                    <span class="cem-key-label">${esc(key.label || 'key')}</span>
                    <span class="cem-key-masked">${esc(key.masked || '')}</span>
                    ${isActive ? '<span class="cem-badge">当前</span>' : ''}
                    ${!isActive && isDefault ? '<span class="cem-badge cem-badge-dim">默认</span>' : ''}
                </div>
                <div class="cem-key-actions">
                    <button class="menu_button cem-key-use" data-id="${esc(key.id)}">使用</button>
                    <button class="menu_button cem-key-rename" data-id="${esc(key.id)}">改名</button>
                    <button class="menu_button cem-key-del" data-id="${esc(key.id)}">移除</button>
                </div>
            </div>
        `;
    }).join('');

    $('#cem-editor').html(`
        <div class="cem-form">
            <label class="cem-field">
                <span>名称</span>
                <input id="cem-edit-name" class="text_pole" value="${esc(draft.name ?? '')}" placeholder="例如：北棱改文站">
            </label>
            <label class="cem-field">
                <span>Base URL</span>
                <input id="cem-edit-url" class="text_pole" value="${esc(draft.url ?? '')}" placeholder="https://.../v1">
            </label>
            <label class="cem-field">
                <span>模型（可选）</span>
                <input id="cem-edit-model" class="text_pole" value="${esc(draft.model ?? '')}" placeholder="deepseek-flash/rewrite3-27B">
            </label>
        </div>
        <div class="cem-section">
            <div class="cem-section-head">
                <span>Key（${profile.keys.length}）</span>
                <div class="cem-section-actions">
                    <button id="cem-add-key-manager" class="menu_button">＋ 添加</button>
                    <button id="cem-import-keys" class="menu_button">从酒馆密钥导入</button>
                </div>
            </div>
            <div class="cem-key-list">${keyRows || '<div class="cem-empty cem-small">这个端点还没有 key。</div>'}</div>
        </div>
        <div class="cem-editor-actions">
            <button id="cem-save-draft" class="menu_button">保存</button>
            <button id="cem-apply-profile" class="menu_button">使用此端点</button>
            <button id="cem-delete-profile" class="menu_button cem-danger">删除端点</button>
        </div>
        <div class="cem-editor-hint">Key 保存在酒馆的 secrets.json；这里只记录引用和标签，不复制明文。</div>
    `);

    $('#cem-edit-name').on('input', event => {
        managerDraft.name = String(event.target.value);
    });
    $('#cem-edit-url').on('input', event => {
        managerDraft.url = String(event.target.value);
    });
    $('#cem-edit-model').on('input', event => {
        managerDraft.model = String(event.target.value);
    });
}

function saveDraft() {
    const profile = getProfile(managerProfileId);
    if (!profile) return null;

    profile.name = String($('#cem-edit-name').val() ?? '').trim() || '未命名端点';
    profile.url = String($('#cem-edit-url').val() ?? '').trim();
    profile.model = String($('#cem-edit-model').val() ?? '').trim();
    managerDraft = clone(profile);
    save();
    refreshInline();
    renderManager();
    return profile;
}

/* ------------------------------------------------------------------ */
/* Key 弹窗                                                           */
/* ------------------------------------------------------------------ */

function ensureKeyDialog() {
    if (document.querySelector('#cem-key-dialog')) return;
    $('body').append(`
        <dialog id="cem-key-dialog" class="cem-dialog cem-small-dialog">
            <div class="cem-dialog-title">添加 key</div>
            <div class="cem-key-dialog-body">
                <label class="cem-field">
                    <span>名称</span>
                    <input id="cem-new-key-label" class="text_pole" placeholder="例如：酒馆 key">
                </label>
                <label class="cem-field">
                    <span>Key</span>
                    <input id="cem-new-key-value" class="text_pole" type="password" autocomplete="off" placeholder="粘贴 sk-...">
                </label>
                <div class="cem-dialog-actions cem-dialog-actions-right">
                    <button id="cem-new-key-save" class="menu_button">保存并切换</button>
                    <button id="cem-new-key-cancel" class="menu_button">取消</button>
                </div>
            </div>
        </dialog>
    `);
}

function openKeyDialog(profile) {
    if (!profile) {
        toast('warning', '先保存一个端点');
        return;
    }
    ensureKeyDialog();
    keyDialogProfileId = profile.id;

    const defaultLabel = `key ${profile.keys.length + 1}`;
    $('#cem-new-key-label').val(defaultLabel);
    $('#cem-new-key-value').val('');
    const dialog = document.querySelector('#cem-key-dialog');
    if (dialog && !dialog.open) dialog.showModal();
    setTimeout(() => $('#cem-new-key-value').trigger('focus'), 50);
}

async function saveNewKey() {
    const profile = getProfile(keyDialogProfileId);
    if (!profile) {
        closeDialog('#cem-key-dialog');
        return;
    }

    const value = String($('#cem-new-key-value').val() ?? '').trim();
    const label = String($('#cem-new-key-label').val() ?? '').trim() || 'key';
    if (!value) {
        toast('warning', '先粘贴 key');
        return;
    }

    const previousActive = getActiveSecret();
    const id = await writeSecret(SECRET_KEYS.CUSTOM, value, label);
    if (!id) {
        toast('error', '保存 key 失败，请检查酒馆日志');
        return;
    }

    const entry = getSecretEntries().find(item => item.id === id) || null;
    const key = {
        id: uid(),
        secretId: id,
        label,
        masked: entry?.value || maskTail(value),
    };
    profile.keys.push(key);
    profile.activeKeyId = key.id;

    const isCurrent = normUrl(profile.url) === normUrl(currentUrl());
    if (!isCurrent && previousActive && previousActive.id !== id) {
        // 给别的端点加 key 时，不要把酒馆当前 key 换掉
        await rotateSecret(SECRET_KEYS.CUSTOM, previousActive.id);
    }

    if (isCurrent) {
        getSettings().activeProfileId = profile.id;
    }
    save();
    closeDialog('#cem-key-dialog');
    refreshInline();
    renderManager();
    toast('success', `key 已添加：${keyLabel(key)}`);

    if (isCurrent && getSettings().autoConnect && isCustomSource()) {
        setTimeout(() => $(SEL.connect).trigger('click'), 60);
    }
}

/* ------------------------------------------------------------------ */
/* 导入已有密钥                                                       */
/* ------------------------------------------------------------------ */

function ensureImportDialog() {
    if (document.querySelector('#cem-import-dialog')) return;
    $('body').append(`
        <dialog id="cem-import-dialog" class="cem-dialog cem-small-dialog">
            <div class="cem-dialog-title">从酒馆密钥导入</div>
            <div id="cem-import-list" class="cem-import-list"></div>
            <div class="cem-dialog-actions cem-dialog-actions-right">
                <button id="cem-import-save" class="menu_button">导入选中</button>
                <button id="cem-import-cancel" class="menu_button">取消</button>
            </div>
        </dialog>
    `);
}

function openImportDialog(profile) {
    if (!profile) {
        toast('warning', '先保存一个端点');
        return;
    }
    ensureImportDialog();
    importProfileId = profile.id;

    const existing = new Set(profile.keys.map(key => key.secretId));
    const entries = getSecretEntries().filter(entry => !existing.has(entry.id));

    const $list = $('#cem-import-list').empty();
    if (!entries.length) {
        $list.html('<div class="cem-empty">没有可导入的 key（都已在收藏夹里）。</div>');
    } else {
        for (const entry of entries) {
            $list.append(`
                <label class="cem-import-row">
                    <input type="checkbox" value="${esc(entry.id)}">
                    <span class="cem-import-label">${esc(entry.label || 'key')}</span>
                    <span class="cem-import-masked">${esc(entry.value || '')}</span>
                    ${entry.active ? '<span class="cem-badge">当前</span>' : ''}
                </label>
            `);
        }
    }

    const dialog = document.querySelector('#cem-import-dialog');
    if (dialog && !dialog.open) dialog.showModal();
}

function importSelectedKeys() {
    const profile = getProfile(importProfileId);
    if (!profile) {
        closeDialog('#cem-import-dialog');
        return;
    }

    const entries = getSecretEntries();
    const ids = $('#cem-import-list input[type="checkbox"]:checked')
        .map((_, element) => String(element.value))
        .get();

    if (!ids.length) {
        toast('warning', '先勾选要导入的 key');
        return;
    }

    let first = null;
    for (const secretId of ids) {
        if (profile.keys.some(key => key.secretId === secretId)) continue;
        const entry = entries.find(item => item.id === secretId);
        if (!entry) continue;
        const key = {
            id: uid(),
            secretId,
            label: entry.label || 'key',
            masked: entry.value || '',
        };
        profile.keys.push(key);
        first = first || key;
    }

    if (first && !profile.activeKeyId) profile.activeKeyId = first.id;
    save();
    closeDialog('#cem-import-dialog');
    refreshInline();
    renderManager();
    toast('success', `已导入 ${ids.length} 把 key`);
}

/* ------------------------------------------------------------------ */
/* 设置抽屉                                                           */
/* ------------------------------------------------------------------ */

function injectSettingsDrawer() {
    if (document.querySelector('#cem-settings-drawer')) return;
    const container = document.querySelector('#extensions_settings2')
        || document.querySelector('#extensions_settings');
    if (!container) return;

    container.insertAdjacentHTML('beforeend', `
        <div id="cem-settings-drawer" class="inline-drawer">
            <div class="inline-drawer-toggle inline-drawer-header">
                <b>端点收藏夹</b>
                <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
            </div>
            <div class="inline-drawer-content">
                <div class="cem-drawer-desc">
                    多 URL + 多 Key 管理。在「Custom Endpoint」下方用下拉框切换端点，
                    在「Custom API Key」下方切换该端点的 key。
                </div>
                <label class="checkbox_label">
                    <input id="cem-auto-connect" type="checkbox">
                    <span>切换端点后自动 Connect</span>
                </label>
                <div id="cem-open-manager-drawer" class="menu_button">打开端点收藏夹</div>
                <div class="cem-drawer-hint">Key 仍保存在酒馆的 secrets.json；扩展只记录引用与标签。</div>
            </div>
        </div>
    `);

    $('#cem-auto-connect').prop('checked', getSettings().autoConnect);
}

function closeDialog(selector) {
    const dialog = document.querySelector(selector);
    if (dialog?.open) dialog.close();
}

/* ------------------------------------------------------------------ */
/* 事件                                                               */
/* ------------------------------------------------------------------ */

function bindEvents() {
    $(document).on('change', '#cem-profile-select', async function () {
        const profile = getProfile(String($(this).val() ?? ''));
        if (profile) await applyProfile(profile);
    });

    $(document).on('change', '#cem-key-select', async function () {
        const profile = currentProfile();
        const keyId = String($(this).val() ?? '');
        if (!profile || !keyId) return;
        const key = profile.keys.find(item => item.id === keyId);
        if (!key) return;

        const ok = await activateKey(key);
        if (!ok) {
            toast('error', '这把 key 在酒馆里已不存在，请重新添加');
            refreshInline();
            return;
        }

        profile.activeKeyId = key.id;
        getSettings().activeProfileId = profile.id;
        save();
        refreshInline();
        renderManager();
        toast('success', `已切换 key：${keyLabel(key)}`);

        if (getSettings().autoConnect && isCustomSource()) {
            setTimeout(() => $(SEL.connect).trigger('click'), 60);
        }
    });

    $(document).on('click', '#cem-save-profile', () => openNewProfileDialog({ prefill: true, fromManager: false }));
    $(document).on('click', '#cem-open-manager', () => openManager());
    $(document).on('click', '#cem-open-manager-drawer', () => openManager());
    $(document).on('click', '#cem-add-key', () => {
        const profile = currentProfile();
        if (!profile) {
            toast('info', '先保存端点，再给它添加 key');
            openNewProfileDialog({ prefill: true, fromManager: false });
            return;
        }
        openKeyDialog(profile);
    });

    $(document).on('input', SEL.url, () => refreshInline());
    $(document).on('change', SEL.model, () => refreshInline());

    $(document).on('change', '#cem-auto-connect', function () {
        getSettings().autoConnect = Boolean($(this).prop('checked'));
        save();
    });

    $(document).on('click', '#cem-close', () => closeDialog('#cem-dialog'));

    $(document).on('click', '#cem-new-profile', () => {
        openNewProfileDialog({ prefill: false, fromManager: true });
    });

    $(document).on('click', '#cem-import-current', () => {
        openNewProfileDialog({ prefill: true, fromManager: true });
    });

    $(document).on('input', '#cem-search', () => renderManager());

    $(document).on('click', '.cem-profile-item', function () {
        managerProfileId = String($(this).data('id') ?? '');
        managerDraft = null;
        renderManager();
    });

    $(document).on('click', '#cem-save-draft', () => saveDraft());

    $(document).on('click', '#cem-apply-profile', async () => {
        const profile = saveDraft();
        if (profile) await applyProfile(profile);
    });

    $(document).on('click', '#cem-delete-profile', () => {
        const profile = getProfile(managerProfileId);
        if (!profile) return;
        if (!window.confirm(`删除端点「${profile.name}」？\n只会删除收藏，不会删除酒馆里的 key。`)) return;
        const settings = getSettings();
        settings.profiles = settings.profiles.filter(item => item.id !== profile.id);
        if (settings.activeProfileId === profile.id) settings.activeProfileId = null;
        managerProfileId = settings.profiles[0]?.id || null;
        managerDraft = null;
        save();
        refreshInline();
        renderManager();
        toast('info', '端点已删除');
    });

    $(document).on('click', '#cem-add-key-manager', () => {
        saveDraft();
        const profile = getProfile(managerProfileId);
        if (profile) openKeyDialog(profile);
    });

    $(document).on('click', '#cem-import-keys', () => {
        saveDraft();
        const profile = getProfile(managerProfileId);
        if (profile) openImportDialog(profile);
    });

    $(document).on('click', '.cem-key-use', async function () {
        const profile = getProfile(managerProfileId);
        const key = profile?.keys.find(item => item.id === String($(this).data('id') ?? ''));
        if (!profile || !key) return;
        const ok = await activateKey(key);
        if (!ok) {
            toast('error', '这把 key 在酒馆里已不存在');
            return;
        }
        profile.activeKeyId = key.id;
        getSettings().activeProfileId = profile.id;
        save();
        refreshInline();
        renderManager();
        toast('success', `已切换 key：${keyLabel(key)}`);
        if (normUrl(profile.url) === normUrl(currentUrl()) && getSettings().autoConnect && isCustomSource()) {
            setTimeout(() => $(SEL.connect).trigger('click'), 60);
        }
    });

    $(document).on('click', '.cem-key-rename', function () {
        const profile = getProfile(managerProfileId);
        const key = profile?.keys.find(item => item.id === String($(this).data('id') ?? ''));
        if (!key) return;
        const label = window.prompt('给这把 key 改个名字', key.label || 'key');
        if (label === null) return;
        key.label = String(label).trim() || 'key';
        save();
        refreshInline();
        renderManager();
    });

    $(document).on('click', '.cem-key-del', function () {
        const profile = getProfile(managerProfileId);
        const key = profile?.keys.find(item => item.id === String($(this).data('id') ?? ''));
        if (!profile || !key) return;
        if (!window.confirm(`从收藏夹移除「${key.label || 'key'}」？\n酒馆里的 key 不会被删除。`)) return;
        profile.keys = profile.keys.filter(item => item.id !== key.id);
        if (profile.activeKeyId === key.id) {
            profile.activeKeyId = profile.keys[0]?.id || null;
        }
        save();
        refreshInline();
        renderManager();
    });

    $(document).on('click', '#cem-new-key-save', () => saveNewKey());
    $(document).on('click', '#cem-new-key-cancel', () => closeDialog('#cem-key-dialog'));
    $(document).on('input', '#cem-new-url', () => updateNewBindRow());
    $(document).on('click', '#cem-new-create', () => createNewProfile());
    $(document).on('click', '#cem-new-cancel', () => closeDialog('#cem-new-dialog'));
    $(document).on('click', '#cem-import-save', () => importSelectedKeys());
    $(document).on('click', '#cem-import-cancel', () => closeDialog('#cem-import-dialog'));

    // 点遮罩关闭
    $(document).on('click', '.cem-dialog', function (event) {
        if (event.target === this) this.close();
    });
}

/* ------------------------------------------------------------------ */
/* 初始化                                                             */
/* ------------------------------------------------------------------ */

async function init() {
    getSettings();
    injectInlineBars();
    injectSettingsDrawer();
    ensureManagerDialog();
    ensureKeyDialog();
    ensureNewProfileDialog();
    ensureImportDialog();
    bindEvents();

    try {
        await readSecretState();
    } catch {
        /* ST 可能已经在初始化，忽略 */
    }

    refreshInline();
    renderManager();

    $('#cem-auto-connect').prop('checked', getSettings().autoConnect);
}

jQuery(async () => {
    for (let i = 0; i < 60; i++) {
        const hasEndpointField = document.querySelector(SEL.url);
        const hasExtensionsPanel = document.querySelector('#extensions_settings2')
            || document.querySelector('#extensions_settings');
        if (hasEndpointField && hasExtensionsPanel) break;
        await new Promise(resolve => setTimeout(resolve, 250));
    }
    await init();
});

for (const eventName of [
    event_types.SECRET_WRITTEN,
    event_types.SECRET_ROTATED,
    event_types.SECRET_DELETED,
]) {
    eventSource.on(eventName, key => {
        if (key !== SECRET_KEYS.CUSTOM) return;
        refreshInline();
        renderManager();
    });
}
