/* Workflow Timeline Visualizer Script - Desk Suite */

frappe.ui.form.on('*', {
	refresh: function (frm) {
		// Only render for saved records
		if (frm.doc.__islocal) {
			remove_workflow_timeline(frm);
			return;
		}

		frappe.call({
			method: "desk_suite.api.workflow_timeline.get_workflow_timeline_data",
			args: {
				doctype: frm.doctype,
				docname: frm.doc.name
			},
			callback: function (r) {
				if (r.message && r.message.has_workflow) {
					render_workflow_timeline(frm, r.message);
				} else {
					remove_workflow_timeline(frm);
				}
			}
		});
	}
});

function remove_workflow_timeline(frm) {
	if (frm.layout && frm.layout.wrapper) {
		frm.layout.wrapper.find('.workflow-timeline-wrapper').remove();
	}
}

function render_workflow_timeline(frm, data) {
	remove_workflow_timeline(frm);

	const nodes = data.nodes || [];
	const edges = data.edges || [];

	if (nodes.length === 0) return;

	// Build wrapper container
	const $wrapper = $(`
		<div class="workflow-timeline-wrapper">
			<div class="workflow-timeline-header">
				<div class="workflow-timeline-title">
					<svg class="octicon octicon-git-commit" width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
						<path fill-rule="evenodd" d="M10.5 8a2.5 2.5 0 11-5 0 2.5 2.5 0 015 0zM1.75 7.25a.75.75 0 000 1.5h2.083a3.999 3.999 0 017.334 0h2.083a.75.75 0 000-1.5h-2.083a3.999 3.999 0 01-7.334 0H1.75z"></path>
					</svg>
					${__('Workflow Transition Path')}
				</div>
				<div class="workflow-timeline-badge label label-info" style="font-size:11px;">
					${data.workflow_name}
				</div>
			</div>
			<div class="workflow-timeline-canvas-container">
				<svg class="workflow-timeline-svg"></svg>
			</div>
		</div>
	`);

	// Inject at top of form layout
	if (frm.dashboard && frm.dashboard.wrapper) {
		frm.dashboard.wrapper.after($wrapper);
	} else {
		frm.layout.wrapper.prepend($wrapper);
	}

	const svg = $wrapper.find('.workflow-timeline-svg')[0];
	draw_timeline_svg(svg, nodes, edges);
}

function draw_timeline_svg(svg, nodes, edges) {
	const node_count = nodes.length;
	const padding_x = 80;
	const node_spacing = Math.max(160, 800 / Math.max(node_count, 1));
	const svg_width = Math.max(700, padding_x * 2 + (node_count - 1) * node_spacing);
	const main_y = 65;
	const svg_height = 140;

	svg.setAttribute("viewBox", `0 0 ${svg_width} ${svg_height}`);
	svg.setAttribute("width", "100%");
	svg.setAttribute("height", svg_height);

	// Map node ID to X coordinate
	const node_coords = {};
	nodes.forEach((node, idx) => {
		node_coords[node.id] = {
			x: padding_x + idx * node_spacing,
			y: main_y,
			data: node
		};
	});

	let svg_content = `
		<defs>
			<marker id="marker-approved" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
				<path d="M 0 0 L 10 5 L 0 10 z" fill="#10b981" />
			</marker>
			<marker id="marker-pending" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
				<path d="M 0 0 L 10 5 L 0 10 z" fill="#f59e0b" />
			</marker>
			<marker id="marker-rejected" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
				<path d="M 0 0 L 10 5 L 0 10 z" fill="#ef4444" />
			</marker>
			<marker id="marker-future" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
				<path d="M 0 0 L 10 5 L 0 10 z" fill="#cbd5e1" />
			</marker>
		</defs>
	`;

	// 1. Draw Edges
	edges.forEach(edge => {
		const source = node_coords[edge.from];
		const target = node_coords[edge.to];
		if (!source || !target) return;

		const is_arc = edge.is_arc || edge.status === "rejected";
		let path_d = "";
		let mid_x = (source.x + target.x) / 2;
		let mid_y = main_y;

		if (is_arc) {
			// Curved arc above the main axis for rejections / loopbacks
			const arc_height = 40;
			mid_y = main_y - arc_height;
			path_d = `M ${source.x} ${source.y - 12} Q ${mid_x} ${mid_y} ${target.x} ${target.y - 12}`;
		} else {
			// Straight horizontal line
			path_d = `M ${source.x + 14} ${source.y} L ${target.x - 14} ${target.y}`;
		}

		let marker_id = "marker-future";
		if (edge.status === "approved") marker_id = "marker-approved";
		if (edge.status === "pending_active") marker_id = "marker-pending";
		if (edge.status === "rejected") marker_id = "marker-rejected";

		svg_content += `
			<path class="wf-edge-line ${edge.status}" d="${path_d}" marker-end="url(#${marker_id})" />
		`;

		// Duration Pill Badge on Edge
		if (edge.duration) {
			const pill_w = Math.max(42, edge.duration.length * 7 + 12);
			const pill_h = 18;
			const pill_class = edge.status === "rejected" ? "rejected-pill" : "approved-pill";

			svg_content += `
				<g transform="translate(${mid_x - pill_w / 2}, ${mid_y - pill_h / 2})">
					<rect class="wf-duration-pill ${pill_class}" width="${pill_w}" height="${pill_h}" />
					<text class="wf-duration-text" x="${pill_w / 2}" y="${pill_h / 2}">${edge.duration}</text>
				</g>
			`;
		}
	});

	// 2. Draw Nodes
	nodes.forEach(node => {
		const coord = node_coords[node.id];
		const is_current = node.status === "current";
		const radius = is_current ? 16 : 14;

		let icon_symbol = "";
		if (node.status === "approved") {
			// Checkmark
			icon_symbol = `<path d="M ${coord.x - 4} ${coord.y} L ${coord.x - 1} ${coord.y + 4} L ${coord.x + 5} ${coord.y - 4}" stroke="#ffffff" stroke-width="2.5" fill="none" />`;
		} else if (node.docstatus === 1) {
			// Star / Lock icon for final target
			icon_symbol = `<circle cx="${coord.x}" cy="${coord.y}" r="4" fill="#ffffff" />`;
		}

		const tooltip_text = `${node.label} ${node.user ? ' - ' + node.user : ''} ${node.timestamp ? '(' + node.timestamp + ')' : ''}`;

		svg_content += `
			<g class="wf-node" data-toggle="tooltip" title="${frappe.utils.escape_html(tooltip_text)}">
				<circle class="wf-node-circle ${node.status}" cx="${coord.x}" cy="${coord.y}" r="${radius}" />
				${icon_symbol}
				<text class="wf-node-label" x="${coord.x}" y="${coord.y + 32}">${frappe.utils.escape_html(node.label)}</text>
				${node.user ? `<text class="wf-node-sublabel" x="${coord.x}" y="${coord.y + 46}">${frappe.utils.escape_html(node.user)}</text>` : ''}
			</g>
		`;
	});

	svg.innerHTML = svg_content;
}
