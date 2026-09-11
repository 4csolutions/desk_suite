// Copyright (c) 2026, Syed Mujeer Hashmi and contributors
// For license information, please see license.txt

frappe.provide('frappe.ui.form');

// Inject Voice Dictation Styles
const style = document.createElement('style');
style.textContent = `
    .ql-speech {
        display: inline-flex !important;
        align-items: center;
        justify-content: center;
        transition: all 0.2s ease;
    }
    .ql-speech:hover {
        color: #ef4444 !important;
    }
    .ql-speech.ql-active {
        color: #ef4444 !important;
        background-color: rgba(239, 68, 68, 0.1) !important;
        border-radius: 4px;
        animation: mic-pulse 1.5s infinite ease-in-out;
    }
    @keyframes mic-pulse {
        0% {
            box-shadow: 0 0 0 0 rgba(239, 68, 68, 0.4);
        }
        70% {
            box-shadow: 0 0 0 6px rgba(239, 68, 68, 0);
        }
        100% {
            box-shadow: 0 0 0 0 rgba(239, 68, 68, 0);
        }
    }
    .speech-listening-pill {
        position: absolute;
        bottom: 12px;
        right: 12px;
        background: rgba(17, 24, 39, 0.85);
        backdrop-filter: blur(8px);
        -webkit-backdrop-filter: blur(8px);
        border: 1px solid rgba(255, 255, 255, 0.1);
        color: #ffffff;
        padding: 8px 14px;
        border-radius: 20px;
        font-size: 12px;
        font-weight: 500;
        display: flex;
        align-items: center;
        gap: 8px;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
        z-index: 100;
        pointer-events: none;
        transition: all 0.3s ease;
    }
    .speech-listening-pill .wave-dot {
        width: 6px;
        height: 6px;
        background-color: #ef4444;
        border-radius: 50%;
        animation: wave-bounce 1.2s infinite ease-in-out;
    }
    .speech-listening-pill .wave-dot:nth-child(2) {
        animation-delay: 0.2s;
    }
    .speech-listening-pill .wave-dot:nth-child(3) {
        animation-delay: 0.4s;
    }
    @keyframes wave-bounce {
        0%, 100% {
            transform: translateY(0);
        }
        50% {
            transform: translateY(-4px);
        }
    }
`;
document.head.appendChild(style);

function extend_control_text_editor() {
    if (frappe.ui.form.ControlTextEditor.prototype.toggle_speech_dictation) {
        // Prevent duplicate initialization if script is loaded twice
        return;
    }

    const ControlTextEditor = frappe.ui.form.ControlTextEditor;

    // Helper: Determine if toolbar and dictation should be enabled
    ControlTextEditor.prototype.should_show_speech_dictation = function() {
        // In inline grid row (child table list view), Frappe explicitly sets this.grid_row on the control
        // and sets options.modules.toolbar = []. If this.grid_row exists, it is an inline grid cell control.
        if (this.grid_row) {
            return false;
        }

        // If in a static column of a grid row (inline grid row cell)
        if (this.$wrapper && this.$wrapper.closest(".grid-static-col").length) {
            return false;
        }

        // In expanded child table row form (GridRowForm), the control is inside .form-in-grid
        // and has the complete toolbar enabled.
        return true;
    };

    // 1. Override get_quill_options to dynamically insert the 'speech' button into toolbar
    const original_get_quill_options = ControlTextEditor.prototype.get_quill_options;
    ControlTextEditor.prototype.get_quill_options = function() {
        const options = original_get_quill_options.call(this);

        // If dictation shouldn't be shown or if Frappe has hidden/emptied the toolbar:
        if (!this.should_show_speech_dictation()) {
            return options;
        }

        if (
            options.modules &&
            options.modules.toolbar &&
            Array.isArray(options.modules.toolbar) &&
            options.modules.toolbar.length > 0
        ) {
            let has_speech = false;
            for (let group of options.modules.toolbar) {
                if (Array.isArray(group) && group.includes("speech")) {
                    has_speech = true;
                    break;
                }
            }
            if (!has_speech) {
                options.modules.toolbar.push(["speech"]);
            }
        }
        return options;
    };

    // 2. Intercept make_quill_editor and refresh to configure speech dictation
    const original_make_quill_editor = ControlTextEditor.prototype.make_quill_editor;
    ControlTextEditor.prototype.make_quill_editor = function() {
        original_make_quill_editor.call(this);
        if (this.quill && this.should_show_speech_dictation()) {
            this.setup_speech_dictation();
        } else {
            this.$wrapper.find(".ql-speech").remove();
        }
    };

    // Also hook refresh so that when a child table row is expanded into .form-in-grid,
    // the toolbar button is properly configured once visible.
    const original_refresh = ControlTextEditor.prototype.refresh;
    ControlTextEditor.prototype.refresh = function() {
        if (original_refresh) {
            original_refresh.call(this);
        }
        if (this.quill && this.should_show_speech_dictation()) {
            this.setup_speech_dictation();
        }
    };

    // 3. Add Speech Dictation Setup and Handlers
    ControlTextEditor.prototype.setup_speech_dictation = function() {
        if (!this.should_show_speech_dictation()) {
            this.$wrapper.find(".ql-speech").remove();
            return;
        }

        const toolbar = this.quill.getModule("toolbar");
        if (!toolbar) return;

        // Ensure toolbar is present in the DOM
        const $toolbar = this.$wrapper.find(".ql-toolbar");
        if (!$toolbar.length) {
            return;
        }

        // Must not be an empty toolbar (e.g. inline grid cells have 0 toolbar children)
        if ($toolbar.children().length === 0) {
            this.$wrapper.find(".ql-speech").remove();
            return;
        }

        let $speech_btn = $toolbar.find(".ql-speech");
        if (!$speech_btn.length) {
            // Quill doesn't automatically create DOM buttons for custom toolbar keys
            // without custom format handlers, so we append the button into the toolbar
            const $group = $(`<span class="ql-formats"></span>`).appendTo($toolbar);
            $speech_btn = $(`<button type="button" class="ql-speech" title="${__("Voice Dictation")}"></button>`).appendTo($group);
        }

        // Render beautiful SVG microphone icon
        $speech_btn.html(`
            <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2.2" fill="none" stroke-linecap="round" stroke-linejoin="round" class="speech-mic-icon" style="vertical-align: middle;">
                <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path>
                <path d="M19 10v2a7 7 0 0 1-14 0v-2"></path>
                <line x1="12" y1="19" x2="12" y2="23"></line>
                <line x1="8" y1="23" x2="16" y2="23"></line>
            </svg>
        `);
        $speech_btn.attr("title", __("Voice Dictation"));

        // Bind click event directly to avoid Quill toolbar routing limitations
        $speech_btn.off("click").on("click", (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.toggle_speech_dictation();
        });
    };

    ControlTextEditor.prototype.toggle_speech_dictation = function() {
        if (this.is_recording) {
            this.stop_speech_dictation();
        } else {
            this.start_speech_dictation();
        }
    };

    ControlTextEditor.prototype.start_speech_dictation = function() {
        // Stop any other active speech dictation
        if (window.cur_active_speech_control && window.cur_active_speech_control !== this) {
            window.cur_active_speech_control.stop_speech_dictation();
        }

        if (window.isSecureContext === false) {
            frappe.msgprint({
                title: __("Secure Connection Required"),
                message: __("Voice dictation (Speech Recognition) is blocked by the browser on insecure (HTTP) origins. Please access the site using <b>HTTPS</b> or via <b>localhost</b> / <b>127.0.0.1</b>."),
                indicator: "orange"
            });
            return;
        }

        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!SpeechRecognition) {
            frappe.msgprint(__("Speech recognition is not supported in this browser. Please use Chrome, Safari, or Edge."));
            return;
        }

        // Set focus to quill editor and get starting index
        this.quill.focus();
        this.speech_start_index = this.quill.getSelection() ? this.quill.getSelection().index : this.quill.getLength() - 1;
        this.speech_last_len = 0;

        // Auto space prepending
        this.speech_prefix = '';
        if (this.speech_start_index > 0) {
            const preceding_char = this.quill.getText(this.speech_start_index - 1, 1);
            if (preceding_char && preceding_char !== ' ' && preceding_char !== '\n' && preceding_char !== '\xa0') {
                this.speech_prefix = ' ';
            }
        }

        if (!this.recognition) {
            this.init_speech_recognition(SpeechRecognition);
        }

        try {
            this.recognition.start();
            window.cur_active_speech_control = this;
        } catch (e) {
            console.error("Failed to start speech recognition:", e);
        }
    };

    ControlTextEditor.prototype.stop_speech_dictation = function() {
        if (this.recognition) {
            try {
                this.recognition.stop();
            } catch (e) {
                console.error("Failed to stop speech recognition:", e);
            }
        }
        this.is_recording = false;
        this.update_speech_ui(false);
        if (window.cur_active_speech_control === this) {
            window.cur_active_speech_control = null;
        }
    };

    ControlTextEditor.prototype.init_speech_recognition = function(SpeechRecognition) {
        this.recognition = new SpeechRecognition();
        this.recognition.continuous = true;
        this.recognition.interimResults = true;
        this.recognition.lang = frappe.boot.lang || 'en-US';

        this.recognition.onstart = () => {
            this.is_recording = true;
            this.update_speech_ui(true);
        };

        this.recognition.onresult = (event) => {
            let full_final_transcript = '';
            let full_interim_transcript = '';

            for (let i = 0; i < event.results.length; ++i) {
                if (event.results[i].isFinal) {
                    full_final_transcript += event.results[i][0].transcript;
                } else {
                    full_interim_transcript += event.results[i][0].transcript;
                }
            }

            const text_to_insert = this.speech_prefix + full_final_transcript + full_interim_transcript;

            // Delete last inserted speech chunk and insert new accumulated text
            this.quill.deleteText(this.speech_start_index, this.speech_last_len, 'user');
            this.quill.insertText(this.speech_start_index, text_to_insert, 'user');
            this.speech_last_len = text_to_insert.length;

            // Set cursor selection to the end of the text
            this.quill.setSelection(this.speech_start_index + this.speech_last_len);
        };

        this.recognition.onerror = (event) => {
            console.error("Speech recognition error:", event.error);
            if (event.error === 'not-allowed') {
                frappe.show_alert({
                    message: __("Microphone permission denied. Please allow microphone access in your browser settings."),
                    indicator: "red"
                });
            } else if (event.error !== 'aborted') {
                frappe.show_alert({
                    message: __("Speech recognition error: {0}", [event.error]),
                    indicator: "red"
                });
            }
            this.stop_speech_dictation();
        };

        this.recognition.onend = () => {
            this.is_recording = false;
            this.update_speech_ui(false);
            if (window.cur_active_speech_control === this) {
                window.cur_active_speech_control = null;
            }
        };
    };

    ControlTextEditor.prototype.update_speech_ui = function(is_active) {
        const $speech_btn = this.$wrapper.find(".ql-speech");
        if (!$speech_btn.length) return;

        if (is_active) {
            $speech_btn.addClass("ql-active");

            if (!this.$listening_indicator) {
                this.$listening_indicator = $(`
                    <div class="speech-listening-pill">
                        <span class="wave-dot"></span>
                        <span class="wave-dot"></span>
                        <span class="wave-dot"></span>
                        <span>${__("Listening...")}</span>
                    </div>
                `);
                if (this.quill_container) {
                    this.quill_container.css("position", "relative");
                    this.quill_container.append(this.$listening_indicator);
                }
            }
            this.$listening_indicator.show();
        } else {
            $speech_btn.removeClass("ql-active");
            if (this.$listening_indicator) {
                this.$listening_indicator.hide();
            }
        }
    };
}

if (typeof frappe !== 'undefined' && frappe.ui && frappe.ui.form && frappe.ui.form.ControlTextEditor) {
    extend_control_text_editor();
} else {
    $(document).ready(() => {
        if (typeof frappe !== 'undefined' && frappe.ui && frappe.ui.form && frappe.ui.form.ControlTextEditor) {
            extend_control_text_editor();
        } else {
            $(document).on('app_ready', () => {
                extend_control_text_editor();
            });
        }
    });
}
