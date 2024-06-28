import { getBase64Async, isTrueBoolean, saveBase64AsFile } from '../../utils.js';
import { getContext, getApiUrl, doExtrasFetch, extension_settings, modules, renderExtensionTemplateAsync } from '../../extensions.js';
import { callPopup, getRequestHeaders, saveSettingsDebounced, substituteParams } from '../../../script.js';
import { getMessageTimeStamp } from '../../RossAscends-mods.js';
import { SECRET_KEYS, secret_state } from '../../secrets.js';
import { getMultimodalCaption } from '../shared.js';
import { textgen_types, textgenerationwebui_settings } from '../../textgen-settings.js';
import { SlashCommandParser } from '../../slash-commands/SlashCommandParser.js';
import { SlashCommand } from '../../slash-commands/SlashCommand.js';
import { ARGUMENT_TYPE, SlashCommandArgument, SlashCommandNamedArgument } from '../../slash-commands/SlashCommandArgument.js';
export { MODULE_NAME };

const MODULE_NAME = 'caption';

const PROMPT_DEFAULT = 'What’s in this image?';
const TEMPLATE_DEFAULT = '[{{user}} sends {{char}} a picture that contains: {{caption}}]';

/**
 * Migrates old extension settings to the new format.
 * Must keep this function for compatibility with old settings.
 */
function migrateSettings() {
    if (extension_settings.caption.local !== undefined) {
        extension_settings.caption.source = extension_settings.caption.local ? 'local' : 'extras';
    }

    delete extension_settings.caption.local;

    if (!extension_settings.caption.source) {
        extension_settings.caption.source = 'extras';
    }

    if (extension_settings.caption.source === 'openai') {
        extension_settings.caption.source = 'multimodal';
        extension_settings.caption.multimodal_api = 'openai';
        extension_settings.caption.multimodal_model = 'gpt-4-turbo';
    }

    if (!extension_settings.caption.multimodal_api) {
        extension_settings.caption.multimodal_api = 'openai';
    }

    if (!extension_settings.caption.multimodal_model) {
        extension_settings.caption.multimodal_model = 'gpt-4-turbo';
    }

    if (!extension_settings.caption.prompt) {
        extension_settings.caption.prompt = PROMPT_DEFAULT;
    }

    if (!extension_settings.caption.template) {
        extension_settings.caption.template = TEMPLATE_DEFAULT;
    }
}

/**
 * Sets an image icon for the send button.
 */
async function setImageIcon() {
    try {
        const sendButton = $('#send_picture .extensionsMenuExtensionButton');
        sendButton.addClass('fa-image');
        sendButton.removeClass('fa-hourglass-half');
    }
    catch (error) {
        console.log(error);
    }
}

/**
 * Sets a spinner icon for the send button.
 */
async function setSpinnerIcon() {
    try {
        const sendButton = $('#send_picture .extensionsMenuExtensionButton');
        sendButton.removeClass('fa-image');
        sendButton.addClass('fa-hourglass-half');
    }
    catch (error) {
        console.log(error);
    }
}

/**
 * Sends a captioned message to the chat.
 * @param {string} caption Caption text
 * @param {string} image Image URL
 */
async function sendCaptionedMessage(caption, image) {
    const context = getContext();
    let template = extension_settings.caption.template || TEMPLATE_DEFAULT;

    if (!/{{caption}}/i.test(template)) {
        console.warn('Poka-yoke: Caption template does not contain {{caption}}. Appending it.');
        template += ' {{caption}}';
    }

    let messageText = substituteParams(template).replace(/{{caption}}/i, caption);

    if (extension_settings.caption.refine_mode) {
        messageText = await callPopup(
            '<h3>Review and edit the generated message:</h3>Press "Cancel" to abort the caption sending.',
            'input',
            messageText,
            { rows: 5, okButton: 'Send' });

        if (!messageText) {
            throw new Error('User aborted the caption sending.');
        }
    }

    const message = {
        name: context.name1,
        is_user: true,
        send_date: getMessageTimeStamp(),
        mes: messageText,
        extra: {
            image: image,
            title: messageText,
        },
    };
    context.chat.push(message);
    context.addOneMessage(message);
}

/**
 * Generates a caption for an image using a selected source.
 * @param {string} base64Img Base64 encoded image without the data:image/...;base64, prefix
 * @param {string} fileData Base64 encoded image with the data:image/...;base64, prefix
 * @param {string} externalPrompt Caption prompt
 * @returns {Promise<{caption: string}>} Generated caption
 */
async function doCaptionRequest(base64Img, fileData, externalPrompt) {
    switch (extension_settings.caption.source) {
        case 'local':
            return await captionLocal(base64Img);
        case 'extras':
            return await captionExtras(base64Img);
        case 'horde':
            return await captionHorde(base64Img);
        case 'multimodal':
            return await captionMultimodal(fileData, externalPrompt);
        default:
            throw new Error('Unknown caption source.');
    }
}

/**
 * Generates a caption for an image using Extras API.
 * @param {string} base64Img Base64 encoded image without the data:image/...;base64, prefix
 * @returns {Promise<{caption: string}>} Generated caption
 */
async function captionExtras(base64Img) {
    if (!modules.includes('caption')) {
        throw new Error('No captioning module is available.');
    }

    const url = new URL(getApiUrl());
    url.pathname = '/api/caption';

    const apiResult = await doExtrasFetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Bypass-Tunnel-Reminder': 'bypass',
        },
        body: JSON.stringify({ image: base64Img }),
    });

    if (!apiResult.ok) {
        throw new Error('Failed to caption image via Extras.');
    }

    const data = await apiResult.json();
    return data;
}

/**
 * Generates a caption for an image using a local model.
 * @param {string} base64Img Base64 encoded image without the data:image/...;base64, prefix
 * @returns {Promise<{caption: string}>} Generated caption
 */
async function captionLocal(base64Img) {
    const apiResult = await fetch('/api/extra/caption', {
        method: 'POST',
        headers: getRequestHeaders(),
        body: JSON.stringify({ image: base64Img }),
    });

    if (!apiResult.ok) {
        throw new Error('Failed to caption image via local pipeline.');
    }

    const data = await apiResult.json();
    return data;
}

/**
 * Generates a caption for an image using a Horde model.
 * @param {string} base64Img Base64 encoded image without the data:image/...;base64, prefix
 * @returns {Promise<{caption: string}>} Generated caption
 */
async function captionHorde(base64Img) {
    const apiResult = await fetch('/api/horde/caption-image', {
        method: 'POST',
        headers: getRequestHeaders(),
        body: JSON.stringify({ image: base64Img }),
    });

    if (!apiResult.ok) {
        throw new Error('Failed to caption image via Horde.');
    }

    const data = await apiResult.json();
    return data;
}

/**
 * Generates a caption for an image using a multimodal model.
 * @param {string} base64Img Base64 encoded image with the data:image/...;base64, prefix
 * @param {string} externalPrompt Caption prompt
 * @returns {Promise<{caption: string}>} Generated caption
 */
async function captionMultimodal(base64Img, externalPrompt) {
    let prompt = externalPrompt || extension_settings.caption.prompt || PROMPT_DEFAULT;

    if (!externalPrompt && extension_settings.caption.prompt_ask) {
        const customPrompt = await callPopup('<h3>Enter a comment or question:</h3>', 'input', prompt, { rows: 2 });
        if (!customPrompt) {
            throw new Error('User aborted the caption sending.');
        }
        prompt = String(customPrompt).trim();
    }

    const caption = await getMultimodalCaption(base64Img, prompt);
    return { caption };
}

/**
 * Handles the image selection event.
 * @param {Event} e Input event
 * @param {string} prompt Caption prompt
 * @param {boolean} quiet Suppresses sending a message
 * @returns {Promise<string>} Generated caption
 */
async function onSelectImage(e, prompt, quiet) {
    if (!(e.target instanceof HTMLInputElement)) {
        return '';
    }

    const file = e.target.files[0];
    const form = e.target.form;

    if (!file || !(file instanceof File)) {
        form && form.reset();
        return '';
    }

    const caption = await getCaptionForFile(file, prompt, quiet);
    form && form.reset();
    return caption;
}

/**
 * Gets a caption for an image file.
 * @param {File} file Input file
 * @param {string} prompt Caption prompt
 * @param {boolean} quiet Suppresses sending a message
 * @returns {Promise<string>} Generated caption
 */
async function getCaptionForFile(file, prompt, quiet) {
    try {
        setSpinnerIcon();
        const context = getContext();
        const fileData = await getBase64Async(file);
        const base64Format = fileData.split(',')[0].split(';')[0].split('/')[1];
        const base64Data = fileData.split(',')[1];
        const { caption } = await doCaptionRequest(base64Data, fileData, prompt);
        if (!quiet) {
            const imagePath = await saveBase64AsFile(base64Data, context.name2, '', base64Format);
            await sendCaptionedMessage(caption, imagePath);
        }
        return caption;
    }
    catch (error) {
        toastr.error('Failed to caption image.');
        console.log(error);
        return '';
    }
    finally {
        setImageIcon();
    }
}

function onRefineModeInput() {
    extension_settings.caption.refine_mode = $('#caption_refine_mode').prop('checked');
    saveSettingsDebounced();
}

/**
 * Callback for the /caption command.
 * @param {object} args Named parameters
 * @param {string} prompt Caption prompt
 */
async function captionCommandCallback(args, prompt) {
    const quiet = isTrueBoolean(args?.quiet);
    const id = args?.id;

    if (!isNaN(Number(id))) {
        const message = getContext().chat[id];
        if (message?.extra?.image) {
            try {
                const fetchResult = await fetch(message.extra.image);
                const blob = await fetchResult.blob();
                const file = new File([blob], 'image.jpg', { type: blob.type });
                return await getCaptionForFile(file, prompt, quiet);
            } catch (error) {
                toastr.error('Failed to get image from the message. Make sure the image is accessible.');
                return '';
            }
        }
    }

    return new Promise(resolve => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'image/*';
        input.onchange = async (e) => {
            const caption = await onSelectImage(e, prompt, quiet);
            resolve(caption);
        };
        input.oncancel = () => resolve('');
        input.click();
    });
}

jQuery(async function () {
    function addSendPictureButton() {
        const sendButton = $(`
        <div id="send_picture" class="list-group-item flex-container flexGap5">
            <div class="fa-solid fa-image extensionsMenuExtensionButton"></div>
            Generate Caption
        </div>`);

        $('#extensionsMenu').prepend(sendButton);
        $(sendButton).on('click', () => {
            const hasCaptionModule =
                (modules.includes('caption') && extension_settings.caption.source === 'extras') ||
                (extension_settings.caption.source === 'multimodal' && extension_settings.caption.multimodal_api === 'openai' && (secret_state[SECRET_KEYS.OPENAI] || extension_settings.caption.allow_reverse_proxy)) ||
                (extension_settings.caption.source === 'multimodal' && extension_settings.caption.multimodal_api === 'openrouter' && secret_state[SECRET_KEYS.OPENROUTER]) ||
                (extension_settings.caption.source === 'multimodal' && extension_settings.caption.multimodal_api === 'google' && (secret_state[SECRET_KEYS.MAKERSUITE] || extension_settings.caption.allow_reverse_proxy)) ||
                (extension_settings.caption.source === 'multimodal' && extension_settings.caption.multimodal_api === 'anthropic' && (secret_state[SECRET_KEYS.CLAUDE] || extension_settings.caption.allow_reverse_proxy)) ||
                (extension_settings.caption.source === 'multimodal' && extension_settings.caption.multimodal_api === 'ollama' && textgenerationwebui_settings.server_urls[textgen_types.OLLAMA]) ||
                (extension_settings.caption.source === 'multimodal' && extension_settings.caption.multimodal_api === 'llamacpp' && textgenerationwebui_settings.server_urls[textgen_types.LLAMACPP]) ||
                (extension_settings.caption.source === 'multimodal' && extension_settings.caption.multimodal_api === 'ooba' && textgenerationwebui_settings.server_urls[textgen_types.OOBA]) ||
                (extension_settings.caption.source === 'multimodal' && extension_settings.caption.multimodal_api === 'koboldcpp' && textgenerationwebui_settings.server_urls[textgen_types.KOBOLDCPP]) ||
                (extension_settings.caption.source === 'multimodal' && extension_settings.caption.multimodal_api === 'custom') ||
                extension_settings.caption.source === 'local' ||
                extension_settings.caption.source === 'horde';

            if (!hasCaptionModule) {
                toastr.error('Choose other captioning source in the extension settings.', 'Captioning is not available');
                return;
            }

            $('#img_file').trigger('click');
        });
    }
    function addPictureSendForm() {
        const inputHtml = '<input id="img_file" type="file" hidden accept="image/*">';
        const imgForm = document.createElement('form');
        imgForm.id = 'img_form';
        $(imgForm).append(inputHtml);
        $(imgForm).hide();
        $('#form_sheld').append(imgForm);
        $('#img_file').on('change', (e) => onSelectImage(e.originalEvent, '', false));
    }
    function switchMultimodalBlocks() {
        const isMultimodal = extension_settings.caption.source === 'multimodal';
        $('#caption_multimodal_block').toggle(isMultimodal);
        $('#caption_prompt_block').toggle(isMultimodal);
        $('#caption_multimodal_api').val(extension_settings.caption.multimodal_api);
        $('#caption_multimodal_model').val(extension_settings.caption.multimodal_model);
        $('#caption_multimodal_block [data-type]').each(function () {
            const type = $(this).data('type');
            const types = type.split(',');
            $(this).toggle(types.includes(extension_settings.caption.multimodal_api));
        });
        $('#caption_multimodal_api').on('change', () => {
            const api = String($('#caption_multimodal_api').val());
            const model = String($(`#caption_multimodal_model option[data-type="${api}"]`).first().val());
            extension_settings.caption.multimodal_api = api;
            extension_settings.caption.multimodal_model = model;
            saveSettingsDebounced();
            switchMultimodalBlocks();
        });
        $('#caption_multimodal_model').on('change', () => {
            extension_settings.caption.multimodal_model = String($('#caption_multimodal_model').val());
            saveSettingsDebounced();
        });
    }
    async function addSettings() {
        const html = await renderExtensionTemplateAsync('caption', 'settings');
        $('#extensions_settings2').append(html);
    }

    await addSettings();
    addPictureSendForm();
    addSendPictureButton();
    setImageIcon();
    migrateSettings();
    switchMultimodalBlocks();

    $('#caption_refine_mode').prop('checked', !!(extension_settings.caption.refine_mode));
    $('#caption_allow_reverse_proxy').prop('checked', !!(extension_settings.caption.allow_reverse_proxy));
    $('#caption_prompt_ask').prop('checked', !!(extension_settings.caption.prompt_ask));
    $('#caption_source').val(extension_settings.caption.source);
    $('#caption_prompt').val(extension_settings.caption.prompt);
    $('#caption_template').val(extension_settings.caption.template);
    $('#caption_refine_mode').on('input', onRefineModeInput);
    $('#caption_source').on('change', () => {
        extension_settings.caption.source = String($('#caption_source').val());
        switchMultimodalBlocks();
        saveSettingsDebounced();
    });
    $('#caption_prompt').on('input', () => {
        extension_settings.caption.prompt = String($('#caption_prompt').val());
        saveSettingsDebounced();
    });
    $('#caption_template').on('input', () => {
        extension_settings.caption.template = String($('#caption_template').val());
        saveSettingsDebounced();
    });
    $('#caption_allow_reverse_proxy').on('input', () => {
        extension_settings.caption.allow_reverse_proxy = $('#caption_allow_reverse_proxy').prop('checked');
        saveSettingsDebounced();
    });
    $('#caption_prompt_ask').on('input', () => {
        extension_settings.caption.prompt_ask = $('#caption_prompt_ask').prop('checked');
        saveSettingsDebounced();
    });

    SlashCommandParser.addCommandObject(SlashCommand.fromProps({ name: 'caption',
        callback: captionCommandCallback,
        returns: 'caption',
        namedArgumentList: [
            new SlashCommandNamedArgument(
                'quiet', 'suppress sending a captioned message', [ARGUMENT_TYPE.BOOLEAN], false, false, 'false', ['true', 'false'],
            ),
            new SlashCommandNamedArgument(
                'id', 'get image from a message with this ID', [ARGUMENT_TYPE.NUMBER], false, false,
            ),
        ],
        unnamedArgumentList: [
            new SlashCommandArgument(
                'prompt', [ARGUMENT_TYPE.STRING], false,
            ),
        ],
        helpString: `
            <div>
                Caption an image with an optional prompt and passes the caption down the pipe.
            </div>
            <div>
                Only multimodal sources support custom prompts.
            </div>
            <div>
                Provide a message ID to get an image from a message instead of uploading one.
            </div>
            <div>
                Set the "quiet" argument to true to suppress sending a captioned message, default: false.
            </div>
        `,
    }));
});
