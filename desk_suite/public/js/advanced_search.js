// Override frappe.ui.form.LinkSelector and ControlLink to support enhanced multi-column search, flexible comparison operators, and tree hierarchy selectors.
$(document).ready(function() {
    if (typeof frappe === "undefined" || !frappe.ui || !frappe.ui.form || !frappe.ui.form.LinkSelector) {
        return;
    }

    let tree_dialog_open = false;

    // Helper to show custom Tree Selection Dialog for tree-structured DocTypes
    function show_tree_selector(doctype, current_value, callback) {
        if (tree_dialog_open) return;
        tree_dialog_open = true;

        let d = new frappe.ui.Dialog({
            title: __("Select {0}", [__(doctype)]),
            fields: [
                {
                    fieldtype: "HTML",
                    fieldname: "tree_container",
                    options: '<div style="max-height: 400px; overflow-y: auto; padding: 10px; border: 1px solid var(--border-color, #f1f3f5); border-radius: 4px;"></div>'
                }
            ],
            primary_action_label: __("Select"),
            primary_action: function() {
                if (d.selected_node) {
                    callback(d.selected_node.label);
                    d.hide();
                } else {
                    frappe.msgprint(__("Please select a node first"));
                }
            }
        });

        d.onhide = function() {
            tree_dialog_open = false;
        };

        // Delegate double click events on tree nodes to trigger selection
        let container = d.get_field("tree_container").$wrapper;
        container.on("dblclick", ".tree-link", function(e) {
            e.preventDefault();
            if (d.selected_node) {
                callback(d.selected_node.label);
                d.hide();
            }
        });

        frappe.call({
            method: "frappe.desk.treeview.get_children",
            args: {
                doctype: doctype,
                parent: "",
                is_root: true
            },
            callback: function(r) {
                let root_val = (r.message && r.message.length > 0) ? r.message[0].value : doctype;
                let root_lbl = (r.message && r.message.length > 0) ? r.message[0].title : doctype;

                let tree = new frappe.ui.Tree({
                    parent: d.get_field("tree_container").$wrapper.find("div"),
                    label: root_lbl,
                    root_value: root_val,
                    expandable: true,
                    args: {
                        doctype: doctype
                    },
                    method: "frappe.desk.treeview.get_children",
                    on_click: (node) => {
                        d.selected_node = node;
                    }
                });
            }
        });

        d.show();
    }

    // Override ControlLink.prototype.open_advanced_search to open custom Tree Selector if target DocType is a tree
    if (!frappe.ui.form.ControlLink.prototype.open_advanced_search.is_overridden) {
        const original_open_advanced_search = frappe.ui.form.ControlLink.prototype.open_advanced_search;
        frappe.ui.form.ControlLink.prototype.open_advanced_search = function() {
            let doctype = this.get_options();
            if (doctype && doctype !== "[Select]") {
                let target_meta = frappe.get_meta(doctype);
                if (target_meta && target_meta.is_tree) {
                    show_tree_selector(doctype, this.get_value(), (val) => {
                        this.set_value(val);
                    });
                    return false;
                }
            }
            return original_open_advanced_search.apply(this, arguments);
        };
        frappe.ui.form.ControlLink.prototype.open_advanced_search.is_overridden = true;
    }

    // Override LinkSelector.prototype.make
    if (!frappe.ui.form.LinkSelector.prototype.make.is_overridden) {
        frappe.ui.form.LinkSelector.prototype.make = function() {
            var me = this;
            this.start = 0;
            this.page_length = 10;

            let search_fields = [];
            if (this.doctype && this.doctype !== "[Select]") {
                let meta = frappe.get_meta(this.doctype);
                if (meta && meta.search_fields) {
                    search_fields = meta.search_fields.split(",").map(f => f.trim());
                }
            }

            // Remove duplicates from search_fields
            search_fields = [...new Set(search_fields)];

            // Load all target link field doctype definitions first to check if they are tree structures
            let link_fields_to_load = [];
            search_fields.forEach(fieldname => {
                let df = frappe.meta.get_docfield(this.doctype, fieldname);
                if (df && df.fieldtype === "Link") {
                    link_fields_to_load.push(df.options);
                }
            });

            let promises = link_fields_to_load.map(dt => {
                return new Promise(resolve => {
                    frappe.model.with_doctype(dt, resolve);
                });
            });

            Promise.all(promises).then(() => {
                me.build_dialog(search_fields);
            });
        };
        frappe.ui.form.LinkSelector.prototype.make.is_overridden = true;
    }

    // Override LinkSelector.prototype.build_dialog
    frappe.ui.form.LinkSelector.prototype.build_dialog = function(search_fields) {
        var me = this;
        let fields = [];

        if (search_fields.length > 0) {
            fields.push({
                fieldtype: "Section Break"
            });

            search_fields.forEach((fieldname, index) => {
                let df = frappe.meta.get_docfield(this.doctype, fieldname);
                if (df) {
                    if (index > 0 && index % 2 === 0) {
                        fields.push({ fieldtype: "Column Break" });
                    } else if (index === 0) {
                        fields.push({ fieldtype: "Column Break" });
                    }

                    // Convert rich text/markdown/code/text fields to simple Data input
                    let fieldtype = df.fieldtype;
                    if (["Text Editor", "Code", "Text", "Small Text", "Markdown", "Long Text"].includes(fieldtype)) {
                        fieldtype = "Data";
                    }

                    // Filter Value Field
                    fields.push({
                        fieldtype: fieldtype,
                        label: __(df.label),
                        fieldname: fieldname,
                        options: df.options,
                        default: (this.target && this.target.doc) ? this.target.doc[fieldname] : undefined
                    });
                }
            });
        }

        fields.push({
            fieldtype: "Section Break"
        });

        fields.push({
            fieldtype: "HTML",
            fieldname: "filter_area"
        });

        fields.push({
            fieldtype: "Section Break"
        });

        fields.push({
            fieldtype: "HTML",
            fieldname: "results"
        });

        fields.push({
            fieldtype: "Button",
            fieldname: "more",
            label: __("More"),
            click: () => {
                me.start += me.page_length;
                me.search();
            }
        });

        this.dialog = new frappe.ui.Dialog({
            title: __("Select {0}", [this.doctype == "[Select]" ? __("value") : __(this.doctype)]),
            fields: fields,
            size: "large",
            primary_action_label: __("Search"),
            primary_action: function () {
                me.start = 0;
                me.search();
            }
        });

        const refresh_results = frappe.utils.debounce(() => {
            me.start = 0;
            me.search();
        }, 300);

        // Bind change events to standard filter fields and operator selectors
        search_fields.forEach(fieldname => {
            let field = this.dialog.get_field(fieldname);

            if (field) {
                field.df.onchange = () => {
                    refresh_results();
                };

                let fieldtype = field.df.fieldtype;
                let operators = [
                    { val: "=", label: __("Equals"), symbol: "=" },
                    { val: "like", label: __("Like"), symbol: "≈" },
                    { val: "!=", label: __("Not Equals"), symbol: "!=" },
                    { val: "not like", label: __("Not Like"), symbol: "!≈" },
                    { val: "in", label: __("In"), symbol: "in" },
                    { val: "not in", label: __("Not In"), symbol: "!in" }
                ];
                let default_op = "=";

                if (["Int", "Float", "Currency", "Percent", "Date", "Datetime"].includes(fieldtype)) {
                    operators = [
                        { val: "=", label: __("Equals"), symbol: "=" },
                        { val: ">", label: __("Greater Than"), symbol: ">" },
                        { val: "<", label: __("Less Than"), symbol: "<" },
                        { val: ">=", label: __("Greater Than Or Equal To"), symbol: ">=" },
                        { val: "<=", label: __("Less Than Or Equal To"), symbol: "<=" },
                        { val: "!=", label: __("Not Equals"), symbol: "!=" }
                    ];
                    default_op = "=";
                } else if (["Data", "Read Only"].includes(fieldtype)) {
                    operators = [
                        { val: "like", label: __("Like"), symbol: "≈" },
                        { val: "=", label: __("Equals"), symbol: "=" },
                        { val: "!=", label: __("Not Equals"), symbol: "!=" },
                        { val: "not like", label: __("Not Like"), symbol: "!≈" }
                    ];
                    default_op = "like";
                }

                field.selected_operator = default_op;
                let default_symbol = operators.find(o => o.val === default_op).symbol;

                // Wrap input element in bootstrap input-group with strict flex layout
                let $input = field.$input;
                if ($input && $input.length) {
                    $input.wrap('<div class="input-group" style="display: flex !important; flex-direction: row !important; align-items: center !important; width: 100% !important; flex-wrap: nowrap !important;"></div>');
                    $input.css("border-top-right-radius", "0");
                    $input.css("border-bottom-right-radius", "0");
                    $input.css("flex-grow", "1");

                    // Generate and inject operator dropdown HTML
                    let dropdown_html = `
                        <div class="input-group-append" style="display: flex !important; flex-shrink: 0 !important;">
                            <button class="btn btn-outline-secondary dropdown-toggle op-btn" type="button" data-toggle="dropdown" aria-haspopup="true" aria-expanded="false" style="padding: 4px 10px; border: 1px solid var(--border-color); border-left: none; border-top-left-radius: 0; border-bottom-left-radius: 0; background-color: var(--light-bg); color: var(--text-muted); font-weight: bold; font-size: 13px; height: 100%;">
                                ${default_symbol}
                            </button>
                            <div class="dropdown-menu dropdown-menu-right" style="min-width: 120px; z-index: 1050;">
                                ${operators.map(op => `
                                    <a class="dropdown-item op-item" href="#" data-value="${op.val}" data-symbol="${op.symbol}" style="padding: 6px 12px; font-size: 13px;">
                                        ${op.label}
                                    </a>
                                `).join("")}
                            </div>
                        </div>
                    `;

                    let $op_wrapper = $(dropdown_html).insertAfter($input);
                    let $op_btn = $op_wrapper.find(".op-btn");

                    // Handle click on operator items
                    $op_wrapper.find(".op-item").on("click", function(e) {
                        e.preventDefault();
                        let selected_val = $(this).attr("data-value");
                        let selected_symbol = $(this).attr("data-symbol");
                        field.selected_operator = selected_val;
                        $op_btn.text(selected_symbol);
                        refresh_results();
                    });
                }

                if (field.df.fieldtype === "Link") {
                    let target_meta = frappe.get_meta(field.df.options);
                    if (target_meta && target_meta.is_tree) {
                        field.$input.off("focus keydown input click");

                        field.$input.on("click", (e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            show_tree_selector(field.df.options, field.get_value(), (val) => {
                                field.set_value(val);
                            });
                        });

                        field.$input_area.find(".link-btn").off("click").on("click", (e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            show_tree_selector(field.df.options, field.get_value(), (val) => {
                                field.set_value(val);
                            });
                            return false;
                        });
                    }
                }
            }
        });

        if (this.doctype && this.doctype !== "[Select]") {
            let filter_area = this.dialog.get_field("filter_area");
            if (filter_area) {
                this.filter_group = new frappe.ui.FilterGroup({
                    parent: filter_area.$wrapper,
                    doctype: this.doctype,
                    on_change: () => {
                        me.start = 0;
                        me.search();
                    }
                });
                this.filter_group.wrapper.find(".apply-filters").hide();
            }
        }

        this.dialog.show();
        this.search();
    };

    // Override LinkSelector.prototype.search
    frappe.ui.form.LinkSelector.prototype.search = function() {
        var args = {
            txt: "",
            searchfield: "name",
            start: this.start,
            page_length: this.page_length,
            filters: {}
        };
        var me = this;

        if (this.target.set_custom_query) {
            this.target.set_custom_query(args);
        }

        if (
            this.target.is_grid &&
            this.target.fieldinfo[this.fieldname] &&
            this.target.fieldinfo[this.fieldname].get_query
        ) {
            $.extend(args, this.target.fieldinfo[this.fieldname].get_query(cur_frm.doc));
        }

        if (!args.filters) {
            args.filters = {};
        }

        let search_fields = [];
        if (this.doctype && this.doctype !== "[Select]") {
            let meta = frappe.get_meta(this.doctype);
            if (meta && meta.search_fields) {
                search_fields = meta.search_fields.split(",").map(f => f.trim());
            }
        }

        // Remove duplicates from search_fields
        search_fields = [...new Set(search_fields)];

        search_fields.forEach(fieldname => {
            let field = this.dialog.fields_dict[fieldname];
            let val = field ? field.get_value() : undefined;
            let op = field ? (field.selected_operator || "=") : "=";

            if (val !== undefined && val !== null && val !== "") {
                if ((op === "like" || op === "not like") && !val.includes("%")) {
                    val = "%" + val + "%";
                }
                args.filters[fieldname] = [op, val];
            }
        });

        if (this.filter_group) {
            let custom_filters = this.filter_group.get_filters().reduce((acc, filter) => {
                return Object.assign(acc, {
                    [filter[1]]: [filter[2], filter[3]]
                });
            }, {});
            $.extend(args.filters, custom_filters);
        }

        frappe.link_search(
            this.doctype,
            args,
            function (results) {
                var parent = me.dialog.fields_dict.results.$wrapper;
                if (args.start === 0) {
                    parent.empty();
                }

                if (results.length) {
                    for (const v of results) {
                        var row = $(
                            repl(
                                '<div class="row link-select-row" style="padding: 10px 15px; border-bottom: 1px solid var(--border-color, #f1f3f5); cursor: pointer; display: flex; align-items: center;">\
                        <div class="col-xs-4 text-break">\
                            <b><a href="#" style="text-decoration: none; color: var(--text-color);">%(name)s</a></b></div>\
                        <div class="col-xs-8 text-break">\
                            <span class="text-muted">%(values)s</span></div>\
                        </div>',
                                {
                                    name: v[0],
                                    values: v.splice(1).join(", "),
                                }
                            )
                        ).appendTo(parent);

                        row.find("a")
                            .attr("data-value", v[0])
                            .click(function () {
                                var value = $(this).attr("data-value");
                                if (me.target.is_grid) {
                                    me.set_in_grid(value).then(() => {
                                        let previous_start = me.start;
                                        let previous_page_length = me.page_length;
                                        me.start = 0;
                                        me.page_length = previous_start + previous_page_length;
                                        me.search();
                                        me.start = previous_start;
                                        me.page_length = previous_page_length;
                                    });
                                } else {
                                    if (me.target.doctype)
                                        me.target.parse_validate_and_set_in_model(value);
                                    else {
                                        me.target.set_input(value);
                                        me.target.$input.trigger("change");
                                    }
                                    me.dialog.hide();
                                }
                                return false;
                            });
                    }
                } else {
                    if (args.start === 0) {
                        $(
                            '<p style="padding: 15px;" class="text-muted text-center">' +
                                __("No Results") +
                                (frappe.model.can_create(me.doctype)
                                    ? '<br><br><a class="new-doc btn btn-default btn-sm">' +
                                      __("Create a new {0}", [__(me.doctype)]) +
                                      "</a>"
                                    : "") +
                                "</p>"
                        ).appendTo(parent)
                        .find(".new-doc")
                        .click(function () {
                            frappe.new_doc(me.doctype);
                        });
                    }
                }

                parent.append('<div style="margin-bottom: 15px;"></div>');
                var more_btn = me.dialog.fields_dict.more.$wrapper;
                if (results.length < me.page_length) {
                    more_btn.hide();
                } else {
                    more_btn.show();
                }
            },
            me.dialog.get_primary_btn()
        );
    };
});
