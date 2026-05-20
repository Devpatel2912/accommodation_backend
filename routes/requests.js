import express from "express";
import { authenticateToken } from "../middlewares/auth.js";
import * as reqCtrl from "../controllers/requestController.js";

const router = express.Router();

// Ping
router.get("/ping", (req, res) => res.json({ message: "Requests route is working" }));

// Members management
router.get("/members/suggestions", authenticateToken, reqCtrl.getMemberSuggestions);
router.get("/members", authenticateToken, reqCtrl.getMyMembers);
router.put("/members/:id", authenticateToken, reqCtrl.updateMember);
router.delete("/members/:id", authenticateToken, reqCtrl.deleteMember);

// Requests CRUD
router.post("/", authenticateToken, reqCtrl.createRequest);
router.get("/my", authenticateToken, reqCtrl.getMyRequests);
router.put("/:id", authenticateToken, reqCtrl.updateMyRequest);
router.delete("/:id", authenticateToken, reqCtrl.deleteRequest);

// Excel upload
router.post("/:id/upload-members", authenticateToken, reqCtrl.excelUpload.single("file"), reqCtrl.uploadMembersExcel);

// Forward to members
router.post("/:id/forward-to-members", authenticateToken, reqCtrl.forwardToMembers);

export default router;
