import express from "express";
import { authenticateToken, authorizeAdmin, authorizeSubAdmin } from "../middlewares/auth.js";
import * as adminCtrl from "../controllers/adminController.js";
import * as allocCtrl from "../controllers/allocationController.js";
import * as userCtrl from "../controllers/userController.js";
import * as roomCtrl from "../controllers/roomController.js";
import * as houseCtrl from "../controllers/houseController.js";

const router = express.Router();

// ─── Pradesh ────────────────────────────────────────────────────────
router.get("/pradesh", authenticateToken, adminCtrl.getPradeshList);

// ─── Members (Admin) ────────────────────────────────────────────────
router.get("/members", authenticateToken, authorizeAdmin, adminCtrl.getAllMembers);
router.put("/members/:id", authenticateToken, authorizeAdmin, adminCtrl.updateMember);
router.delete("/members/:id", authenticateToken, authorizeAdmin, adminCtrl.deleteMember);

// ─── Requests (Admin) ──────────────────────────────────────────────
router.get("/requests", authenticateToken, authorizeAdmin, adminCtrl.getAllRequests);
router.get("/requests/:id", authenticateToken, authorizeAdmin, adminCtrl.getRequestById);
router.put("/requests/:id", authenticateToken, authorizeAdmin, adminCtrl.updateRequest);
router.delete("/requests/:id", authenticateToken, authorizeAdmin, adminCtrl.deleteRequest);

// ─── Allocations ────────────────────────────────────────────────────
router.post("/allocations", authenticateToken, authorizeAdmin, allocCtrl.createAllocation);
router.get("/allocations", authenticateToken, authorizeAdmin, allocCtrl.getAllAllocations);
router.get("/allocations/:id", authenticateToken, authorizeAdmin, allocCtrl.getAllocationById);
router.put("/allocations/:id", authenticateToken, authorizeAdmin, allocCtrl.updateAllocation);
router.delete("/allocations/:id", authenticateToken, authorizeAdmin, allocCtrl.deleteAllocation);

// ─── Allocation Items ───────────────────────────────────────────────
router.post("/allocation-items", authenticateToken, authorizeAdmin, allocCtrl.createAllocationItem);
router.get("/allocation-items", authenticateToken, authorizeAdmin, allocCtrl.getAllAllocationItems);
router.put("/allocation-items/:id", authenticateToken, authorizeAdmin, allocCtrl.updateAllocationItem);
router.delete("/allocation-items/:id", authenticateToken, authorizeAdmin, allocCtrl.deleteAllocationItem);

// ─── Users (Admin) ──────────────────────────────────────────────────
router.post("/users", authenticateToken, authorizeAdmin, userCtrl.createUser);
router.get("/users", authenticateToken, authorizeAdmin, userCtrl.getAllUsers);
router.get("/users/:id", authenticateToken, authorizeAdmin, userCtrl.getUserById);
router.get("/users/:id/members", authenticateToken, authorizeAdmin, userCtrl.getUserMembers);
router.put("/users/:id", authenticateToken, authorizeAdmin, userCtrl.updateUser);
router.delete("/users/:id", authenticateToken, authorizeAdmin, userCtrl.deleteUser);

// ─── Available Rooms/Houses ─────────────────────────────────────────
router.get("/rooms/available", authenticateToken, authorizeSubAdmin, adminCtrl.getAvailableRooms);
router.get("/houses/available", authenticateToken, authorizeSubAdmin, adminCtrl.getAvailableHouses);

// ─── Member Allocations ─────────────────────────────────────────────
router.post("/member-allocations", authenticateToken, authorizeAdmin, allocCtrl.createMemberAllocation);
router.get("/member-allocations", authenticateToken, authorizeAdmin, allocCtrl.getAllMemberAllocations);
router.get("/member-allocations/:id", authenticateToken, authorizeAdmin, allocCtrl.getMemberAllocationById);
router.put("/member-allocations/:id", authenticateToken, authorizeAdmin, allocCtrl.updateMemberAllocation);
router.delete("/member-allocations/:id", authenticateToken, authorizeAdmin, allocCtrl.deleteMemberAllocation);

// ─── Room Bookings ──────────────────────────────────────────────────
router.post("/room-bookings", authenticateToken, authorizeAdmin, roomCtrl.createRoomBooking);
router.get("/room-bookings", authenticateToken, authorizeAdmin, roomCtrl.getAllRoomBookings);
router.get("/room-bookings/:id", authenticateToken, authorizeAdmin, roomCtrl.getRoomBookingById);
router.put("/room-bookings/:id", authenticateToken, authorizeAdmin, roomCtrl.updateRoomBooking);
router.delete("/room-bookings/:id", authenticateToken, authorizeAdmin, roomCtrl.deleteRoomBooking);
router.post("/room-bookings/:id/release", authenticateToken, authorizeAdmin, roomCtrl.releaseRoomBooking);
router.post("/rooms/:room_id/release", authenticateToken, authorizeAdmin, roomCtrl.releaseRoomByRoomId);

// ─── House Bookings ─────────────────────────────────────────────────
router.post("/house-bookings", authenticateToken, authorizeAdmin, houseCtrl.createHouseBooking);
router.get("/house-bookings", authenticateToken, authorizeAdmin, houseCtrl.getAllHouseBookings);
router.get("/house-bookings/:id", authenticateToken, authorizeAdmin, houseCtrl.getHouseBookingById);
router.put("/house-bookings/:id", authenticateToken, authorizeAdmin, houseCtrl.updateHouseBooking);
router.delete("/house-bookings/:id", authenticateToken, authorizeAdmin, houseCtrl.deleteHouseBooking);
router.post("/house-bookings/:id/release", authenticateToken, authorizeAdmin, houseCtrl.releaseHouseBooking);
router.post("/houses/:house_id/release", authenticateToken, authorizeAdmin, houseCtrl.releaseHouseByHouseId);

// ─── Easy Allocation ────────────────────────────────────────────────
router.post("/requests/:id/allocate-member", authenticateToken, authorizeSubAdmin, allocCtrl.allocateMember);
router.post("/requests/:id/sync-allocation", authenticateToken, authorizeSubAdmin, allocCtrl.syncAllocation);
router.post("/requests/:id/accept-complete", authenticateToken, authorizeSubAdmin, allocCtrl.acceptComplete);

export default router;
