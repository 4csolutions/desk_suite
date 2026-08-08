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
					<svg class="octicon octicon-git-commit" width="11" height="11" viewBox="0 0 16 16" fill="currentColor">
						<path fill-rule="evenodd" d="M10.5 8a2.5 2.5 0 11-5 0 2.5 2.5 0 015 0zM1.75 7.25a.75.75 0 000 1.5h2.083a3.999 3.999 0 017.334 0h2.083a.75.75 0 000-1.5h-2.083a3.999 3.999 0 01-7.334 0H1.75z"></path>
					</svg>
					${__('Workflow Transition Path')}
				</div>
				<div class="workflow-timeline-badge label label-info" style="font-size:9px; padding: 1px 4px; opacity: 0.8;">
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
	const padding_x = 55;
	const node_spacing = 140;
	const svg_width = padding_x * 2 + Math.max(0, node_count - 1) * node_spacing;

	// Map node ID to X coordinate and Index
	const node_coords = {};
	nodes.forEach((node, idx) => {
		node_coords[node.id] = {
			x: padding_x + idx * node_spacing,
			index: idx,
			data: node
		};
	});

	// 1. Analyze Top Arc Layers & Pass Baselines
	let max_rejection_index = 0;
	let max_pass_index = 1;

	edges.forEach(edge => {
		const src = node_coords[edge.from];
		const tgt = node_coords[edge.to];
		if (!src || !tgt) return;

		const pass_idx = edge.pass_index || 1;
		if (pass_idx > max_pass_index) {
			max_pass_index = pass_idx;
		}

		if (edge.is_arc || edge.status === "rejected" || src.index > tgt.index) {
			edge.route_type = "top_arc";
			const rej_idx = edge.rejection_index || 1;
			if (rej_idx > max_rejection_index) {
				max_rejection_index = rej_idx;
			}
		} else {
			edge.route_type = "pass_line";
		}
	});

	// 2. Dynamic Height Calculation:
	// Top Space for Red Rejection Arcs above main_y (latest rejection sits on top!)
	const top_space = max_rejection_index > 0 ? (16 + max_rejection_index * 22) : 10;
	const main_y = top_space + 12;

	// Bottom Space for Node Labels + Pass 2+ Baselines below main_y
	const bottom_reapproval_passes = Math.max(0, max_pass_index - 1);
	const bottom_space = bottom_reapproval_passes > 0 ? (46 + bottom_reapproval_passes * 24) : 42;
	const svg_height = main_y + bottom_space;

	svg.setAttribute("width", svg_width);
	svg.setAttribute("height", svg_height);

	// Update node Y coordinates with calculated main_y
	nodes.forEach(node => {
		if (node_coords[node.id]) {
			node_coords[node.id].y = main_y;
		}
	});

	let svg_content = `
		<defs>
			<marker id="marker-approved" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto">
				<path d="M 0 0 L 10 5 L 0 10 z" fill="#10b981" />
			</marker>
			<marker id="marker-reapproved" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto">
				<path d="M 0 0 L 10 5 L 0 10 z" fill="#0284c7" />
			</marker>
			<marker id="marker-pending" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto">
				<path d="M 0 0 L 10 5 L 0 10 z" fill="#f59e0b" />
			</marker>
			<marker id="marker-rejected" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto">
				<path d="M 0 0 L 10 5 L 0 10 z" fill="#ef4444" />
			</marker>
			<marker id="marker-future" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto">
				<path d="M 0 0 L 10 5 L 0 10 z" fill="#cbd5e1" />
			</marker>
		</defs>
	`;

	// 3. Draw Edges
	edges.forEach(edge => {
		const source = node_coords[edge.from];
		const target = node_coords[edge.to];
		if (!source || !target) return;

		let path_d = "";
		let mid_x = (source.x + target.x) / 2;
		let mid_y = main_y;

		const source_r = (source.data.status === "current") ? 11 : 9;
		const target_r = (target.data.status === "current") ? 11 : 9;

		if (edge.route_type === "top_arc") {
			// Top Orthogonal Arc: Up -> Horizontal -> Down (latest rejection sits on top)
			const rej_idx = edge.rejection_index || 1;
			const layer_offset = 20 + (rej_idx - 1) * 22;
			const y_top = main_y - layer_offset;
			mid_y = y_top;

			path_d = `M ${source.x} ${source.y - source_r} L ${source.x} ${y_top} L ${target.x} ${y_top} L ${target.x} ${target.y - target_r - 2}`;
		} else {
			const pass_idx = edge.pass_index || 1;

			if (pass_idx === 1) {
				// Pass 1: Primary horizontal approval line on main_y
				if (source.x < target.x) {
					path_d = `M ${source.x + source_r + 2} ${source.y} L ${target.x - target_r - 2} ${target.y}`;
				} else {
					path_d = `M ${source.x - source_r - 2} ${source.y} L ${target.x + target_r + 2} ${target.y}`;
				}
			} else {
				// Pass 2+: Re-approval Pass line on distinct bottom baseline (below labels)
				const y_pass = main_y + 46 + (pass_idx - 2) * 24;
				mid_y = y_pass;

				// Down from source node, horizontal across on y_pass, up into target node
				path_d = `M ${source.x} ${source.y + source_r} L ${source.x} ${y_pass} L ${target.x} ${y_pass} L ${target.x} ${target.y + target_r + 2}`;
			}
		}

		let marker_id = "marker-future";
		if (edge.status === "approved") marker_id = "marker-approved";
		if (edge.status === "reapproved") marker_id = "marker-reapproved";
		if (edge.status === "pending_active") marker_id = "marker-pending";
		if (edge.status === "rejected") marker_id = "marker-rejected";

		svg_content += `
			<path class="wf-edge-line ${edge.status}" d="${path_d}" marker-end="url(#${marker_id})" />
		`;

		// Duration Pill Badge on Edge
		if (edge.duration) {
			const pill_w = Math.max(44, edge.duration.length * 7 + 10);
			const pill_h = 16;
			let pill_class = "approved-pill";
			if (edge.status === "reapproved") pill_class = "reapproved-pill";
			if (edge.status === "rejected") pill_class = "rejected-pill";
			if (edge.status === "pending_active") pill_class = "current-pill";

			svg_content += `
				<g transform="translate(${mid_x - pill_w / 2}, ${mid_y - pill_h / 2})">
					<rect class="wf-duration-pill ${pill_class}" width="${pill_w}" height="${pill_h}" />
					<text class="wf-duration-text" x="${pill_w / 2}" y="${pill_h / 2}">${edge.duration}</text>
				</g>
			`;
		}
	});

	// 4. Draw Nodes
	nodes.forEach(node => {
		const coord = node_coords[node.id];
		const is_current = node.status === "current";
		const radius = is_current ? 11 : 9;

		let icon_symbol = "";
		if (node.status === "approved") {
			icon_symbol = `<path d="M ${coord.x - 3.5} ${coord.y} L ${coord.x - 0.7} ${coord.y + 3} L ${coord.x + 4} ${coord.y - 3}" stroke="#ffffff" stroke-width="1.8" fill="none" />`;
		} else if (node.docstatus === 1) {
			icon_symbol = `<circle cx="${coord.x}" cy="${coord.y}" r="3" fill="#ffffff" />`;
		} else if (is_current) {
			icon_symbol = `<circle cx="${coord.x}" cy="${coord.y}" r="3" fill="#ffffff" />`;
		}

		const tooltip_text = `${node.label} ${node.user ? ' - ' + node.user : ''} ${node.timestamp ? '(' + node.timestamp + ')' : ''}`;

		svg_content += `
			<g class="wf-node">
				<title>${frappe.utils.escape_html(tooltip_text)}</title>
				<circle class="wf-node-circle ${node.status}" cx="${coord.x}" cy="${coord.y}" r="${radius}" />
				${icon_symbol}
				<text class="wf-node-label" x="${coord.x}" y="${coord.y + 22}">${frappe.utils.escape_html(node.label)}</text>
				${node.user ? `<text class="wf-node-sublabel" x="${coord.x}" y="${coord.y + 34}">${frappe.utils.escape_html(node.user)}</text>` : ''}
			</g>
		`;
	});

	svg.innerHTML = svg_content;
}
