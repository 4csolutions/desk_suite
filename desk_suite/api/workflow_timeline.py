# Copyright (c) 2026, Syed Mujeer Hashmi and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.utils import time_diff_in_seconds


@frappe.whitelist()
def get_workflow_timeline_data(doctype: str, docname: str):
	"""Returns workflow timeline topology and history for a given document.

	Includes:
	- Historical transitions with calculated durations & timestamps.
	- Rejected / Loopback transition arcs.
	- Condition-evaluated future path to final approved state (docstatus = 1).
	"""
	if not doctype or not docname:
		return {"has_workflow": False}

	# 1. Fetch active Workflow for DocType
	workflow_name = frappe.db.get_value("Workflow", {"document_type": doctype, "is_active": 1})
	if not workflow_name:
		return {"has_workflow": False}

	workflow = frappe.get_doc("Workflow", workflow_name)
	state_field = workflow.workflow_state_field or "workflow_state"

	if not frappe.db.exists(doctype, docname):
		return {"has_workflow": False}

	doc = frappe.get_doc(doctype, docname)
	current_state = doc.get(state_field)

	# Build maps for states and doc_status
	state_docstatus_map = {s.state: int(s.doc_status) for s in workflow.states}

	# 2. Extract Audit Log / History
	history = get_workflow_history(doctype, docname, state_field, doc)

	# 3. Dynamic Future Path Resolution (evaluate condition)
	future_path = calculate_future_path(doc, workflow, current_state, state_docstatus_map)

	# 4. Build Graph Topology (Nodes & Edges)
	nodes, edges = build_graph_topology(
		workflow, history, current_state, future_path, state_docstatus_map
	)

	return {
		"has_workflow": True,
		"workflow_name": workflow.name,
		"current_state": current_state,
		"docstatus": doc.docstatus,
		"nodes": nodes,
		"edges": edges,
		"history": history,
	}


def get_workflow_history(doctype, docname, state_field, doc):
	"""Extracts execution history from Workflow Action, Comment, and Version records."""
	history = []

	# Initial Creation
	init_state = workflow_initial_state(doctype, docname, doc, state_field)
	history.append(
		{
			"state": init_state,
			"action": "Created",
			"user": doc.owner,
			"user_full_name": frappe.utils.get_fullname(doc.owner),
			"timestamp": str(doc.creation),
			"raw_datetime": doc.creation,
		}
	)

	# Query Workflow Actions
	actions = frappe.db.get_all(
		"Workflow Action",
		filters={"reference_doctype": doctype, "reference_name": docname},
		fields=["workflow_state", "status", "user", "completed_by", "modified", "creation"],
		order_by="modified asc",
	)

	for act in actions:
		if act.status == "Completed":
			user_email = act.completed_by or act.user or doc.owner
			history.append(
				{
					"state": act.workflow_state,
					"action": "Transitioned",
					"user": user_email,
					"user_full_name": frappe.utils.get_fullname(user_email),
					"timestamp": str(act.modified),
					"raw_datetime": act.modified,
				}
			)

	current_state = doc.get(state_field)

	# Sort by raw_datetime
	history.sort(key=lambda x: x["raw_datetime"])

	# Keep the earliest entry when entering a new state
	unique_history = []
	for item in history:
		if not unique_history or unique_history[-1]["state"] != item["state"]:
			unique_history.append(item)

	# Guarantee current_state is at the end of history if doc has progressed beyond initial state
	if current_state and (not unique_history or unique_history[-1]["state"] != current_state):
		unique_history.append(
			{
				"state": current_state,
				"action": "Current",
				"user": "",
				"user_full_name": "",
				"timestamp": str(doc.modified),
				"raw_datetime": doc.modified,
			}
		)

	# Compute elapsed durations between steps
	for i in range(len(unique_history)):
		if i < len(unique_history) - 1:
			dt1 = unique_history[i]["raw_datetime"]
			dt2 = unique_history[i + 1]["raw_datetime"]
			diff_sec = time_diff_in_seconds(dt2, dt1)
			unique_history[i]["duration"] = format_duration(diff_sec)
		else:
			if unique_history[i]["state"] == current_state:
				diff_sec = time_diff_in_seconds(
					frappe.utils.now_datetime(), unique_history[i]["raw_datetime"]
				)
				unique_history[i]["duration"] = format_duration(diff_sec)
			else:
				unique_history[i]["duration"] = ""

	return unique_history


def workflow_initial_state(doctype, docname, doc, state_field):
	wf_name = frappe.db.get_value("Workflow", {"document_type": doctype, "is_active": 1})
	if wf_name:
		wf = frappe.get_doc("Workflow", wf_name)
		if wf.states:
			return wf.states[0].state
	return doc.get(state_field) or "Draft"


def calculate_future_path(doc, workflow, current_state, state_docstatus_map):
	"""Traverses outgoing transitions from current_state evaluating `condition` Python expressions

	to find the path leading to final approval (docstatus = 1).
	"""
	path = [current_state] if current_state else []
	if not current_state:
		return path

	visited = {current_state}
	curr = current_state

	while True:
		if state_docstatus_map.get(curr) == 1:
			break

		valid_next = None
		for t in workflow.transitions:
			if t.state == curr and t.next_state not in visited:
				if evaluate_transition_condition(t.condition, doc):
					valid_next = t.next_state
					break

		if valid_next:
			path.append(valid_next)
			visited.add(valid_next)
			curr = valid_next
		else:
			break

	return path


def evaluate_transition_condition(condition, doc):
	if not condition:
		return True
	try:
		eval_dict = {"doc": doc.as_dict()}
		return bool(frappe.safe_eval(condition, None, eval_dict))
	except Exception:
		return True


def build_graph_topology(workflow, history, current_state, future_path, state_docstatus_map):
	"""Builds list of nodes and edges for the timeline visualizer graph."""
	history_states = [h["state"] for h in history]
	history_map = {h["state"]: h for h in history}

	active_sequence = []
	for s in history_states:
		if s not in active_sequence:
			active_sequence.append(s)

	for s in future_path:
		if s not in active_sequence:
			active_sequence.append(s)

	nodes = []
	for s in active_sequence:
		is_visited = s in history_states
		is_current = s == current_state
		docstatus = state_docstatus_map.get(s, 0)

		status = "future"
		if is_current and docstatus == 1:
			status = "approved"
		elif is_current:
			status = "current"
		elif is_visited:
			status = "approved"
		elif docstatus == 1:
			status = "final_target"

		hist_entry = history_map.get(s, {})
		nodes.append(
			{
				"id": s,
				"label": s,
				"status": status,
				"docstatus": docstatus,
				"user": hist_entry.get("user_full_name", ""),
				"timestamp": hist_entry.get("timestamp", ""),
				"duration": hist_entry.get("duration", ""),
			}
		)

	edges = []

	# 1. Historical Edges
	for i in range(len(history) - 1):
		from_s = history[i]["state"]
		to_s = history[i + 1]["state"]
		is_rejection = is_rejection_transition(workflow, from_s, to_s)

		if is_rejection:
			edge_status = "rejected"
			dur = history[i].get("duration", "")
		else:
			edge_status = "approved"
			dur = history[i].get("duration", "")

		edges.append(
			{
				"from": from_s,
				"to": to_s,
				"status": edge_status,
				"duration": dur,
				"is_arc": is_rejection,
				"user": history[i].get("user_full_name", ""),
			}
		)

	# 2. Future Path Edges
	for i in range(len(future_path) - 1):
		from_s = future_path[i]
		to_s = future_path[i + 1]
		action_label = get_transition_action(workflow, from_s, to_s)

		already_exists = any(
			e["from"] == from_s and e["to"] == to_s for e in edges if e["status"] == "approved"
		)
		if not already_exists:
			is_next = from_s == current_state
			dur = history_map.get(current_state, {}).get("duration", "") if is_next else ""
			edges.append(
				{
					"from": from_s,
					"to": to_s,
					"action": action_label,
					"status": "pending_active" if is_next else "future",
					"duration": dur,
					"is_arc": False,
				}
			)

	return nodes, edges


def is_rejection_transition(workflow, from_s, to_s):
	for t in workflow.transitions:
		if t.state == from_s and t.next_state == to_s:
			action_lower = (t.action or "").lower()
			if any(k in action_lower for k in ["reject", "return", "send back", "cancel", "deny"]):
				return True
	state_order = [s.state for s in workflow.states]
	if from_s in state_order and to_s in state_order:
		if state_order.index(to_s) < state_order.index(from_s):
			return True
	return False


def get_transition_action(workflow, from_s, to_s):
	for t in workflow.transitions:
		if t.state == from_s and t.next_state == to_s:
			return t.action or ""
	return ""


def format_duration(seconds):
	if seconds is None or seconds < 0:
		return ""
	seconds = int(seconds)
	if seconds == 0:
		return "< 1m"
	if seconds < 60:
		return f"{seconds}s"
	minutes = seconds // 60
	if minutes < 60:
		return f"{minutes}m"
	hours = minutes // 60
	rem_min = minutes % 60
	if hours < 24:
		return f"{hours}h {rem_min}m"
	days = hours // 24
	rem_hrs = hours % 24
	return f"{days}d {rem_hrs}h"
