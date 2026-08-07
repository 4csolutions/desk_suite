# Copyright (c) 2026, Syed Mujeer Hashmi and Contributors
# See license.txt

import frappe
from frappe.tests.utils import FrappeTestCase
from desk_suite.api.workflow_timeline import (
	calculate_future_path,
	evaluate_transition_condition,
	format_duration,
	get_workflow_timeline_data,
	is_rejection_transition,
)


class TestWorkflowTimeline(FrappeTestCase):
	def setUp(self):
		super().setUp()
		self.setup_test_workflow()

	def setup_test_workflow(self):
		if frappe.db.exists("Workflow", "ToDo Test Workflow"):
			return

		# Create states if not exist
		for st in ["Draft", "Pending Review", "Approved", "Rejected"]:
			if not frappe.db.exists("Workflow State", st):
				frappe.get_doc({"doctype": "Workflow State", "workflow_state_name": st}).insert(
					ignore_permissions=True
				)

		# Create actions if not exist
		for act in ["Submit for Review", "Approve", "Reject"]:
			if not frappe.db.exists("Workflow Action Master", act):
				frappe.get_doc(
					{"doctype": "Workflow Action Master", "workflow_action_name": act}
				).insert(ignore_permissions=True)

		wf = frappe.get_doc(
			{
				"doctype": "Workflow",
				"workflow_name": "ToDo Test Workflow",
				"document_type": "ToDo",
				"is_active": 1,
				"workflow_state_field": "workflow_state",
				"states": [
					{"state": "Draft", "doc_status": "0", "allow_edit": "All"},
					{"state": "Pending Review", "doc_status": "0", "allow_edit": "All"},
					{"state": "Approved", "doc_status": "1", "allow_edit": "All"},
					{"state": "Rejected", "doc_status": "0", "allow_edit": "All"},
				],
				"transitions": [
					{
						"state": "Draft",
						"action": "Submit for Review",
						"next_state": "Pending Review",
						"allowed": "All",
					},
					{
						"state": "Pending Review",
						"action": "Approve",
						"next_state": "Approved",
						"allowed": "All",
					},
					{
						"state": "Pending Review",
						"action": "Reject",
						"next_state": "Rejected",
						"allowed": "All",
					},
				],
			}
		).insert(ignore_permissions=True)

	def test_timeline_data_structure(self):
		todo = frappe.get_doc(
			{
				"doctype": "ToDo",
				"description": "Test Workflow Timeline Execution",
				"status": "Open",
			}
		).insert(ignore_permissions=True)

		data = get_workflow_timeline_data("ToDo", todo.name)
		self.assertTrue(data.get("has_workflow"))
		self.assertEqual(data.get("workflow_name"), "ToDo Test Workflow")
		self.assertIn("nodes", data)
		self.assertIn("edges", data)
		self.assertTrue(len(data["nodes"]) >= 2)

	def test_format_duration(self):
		self.assertEqual(format_duration(45), "45s")
		self.assertEqual(format_duration(180), "3m")
		self.assertEqual(format_duration(3660), "1h 1m")
		self.assertEqual(format_duration(90000), "1d 1h")

	def test_rejection_detection(self):
		wf = frappe.get_doc("Workflow", "ToDo Test Workflow")
		self.assertTrue(is_rejection_transition(wf, "Pending Review", "Rejected"))
		self.assertFalse(is_rejection_transition(wf, "Pending Review", "Approved"))

	def test_conditional_future_path(self):
		todo = frappe.get_doc({"doctype": "ToDo", "description": "Test Condition", "status": "Open"}).insert(ignore_permissions=True)
		wf = frappe.get_doc("Workflow", "ToDo Test Workflow")
		path = calculate_future_path(todo, wf, "Draft", {"Draft": 0, "Pending Review": 0, "Approved": 1, "Rejected": 0})
		self.assertEqual(path, ["Draft", "Pending Review", "Approved"])
