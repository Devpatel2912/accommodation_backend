import multer from "multer";
import * as xlsx from "xlsx";
import { supabase } from "../config/supabase.js";
import * as RequestModel from "../models/requestModel.js";
import * as UserModel from "../models/userModel.js";
import { sendRequestConfirmationEmail, sendMemberBookingEmail } from "../utils/email.js";
import { sendPubSubNotification } from "../utils/pubsub.js";

// Multer for in-memory excel uploads
export const excelUpload = multer({ storage: multer.memoryStorage() });

// ─── Deduplicate members helper ─────────────────────────────────────
const deduplicateMembers = (members) => {
  const unique = [];
  const seen = new Set();
  members.forEach(m => {
    const key = `${m.name}-${m.contact}-${m.email}-${m.pradesh}`.toLowerCase();
    if (!seen.has(key) && m.pradesh !== "DELETED") {
      seen.add(key);
      unique.push(m);
    }
  });
  return unique;
};

// ─── GET MEMBER SUGGESTIONS ─────────────────────────────────────────
export const getMemberSuggestions = async (req, res) => {
  const user_id = req.user.id;
  const is_admin = req.user.role === "ADMIN";
  const pradesh = req.query.pradesh?.toString().trim();

  try {
    let members;
    if (is_admin) {
      let query = supabase.from("request_members").select("*");
      if (pradesh) query = query.eq("pradesh", pradesh);
      const { data, error } = await query;
      if (error) throw error;
      members = data;
    } else {
      const { data: requests } = await RequestModel.getRequestIdsByUser(user_id);
      if (!requests || requests.length === 0) return res.json({ success: true, members: [] });
      const { data, error } = await RequestModel.getMembersByRequestIds(requests.map(r => r.id));
      if (error) throw error;
      members = data;
    }
    res.json({ success: true, members: deduplicateMembers(members) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ─── GET USER'S MEMBERS ─────────────────────────────────────────────
export const getMyMembers = async (req, res) => {
  const user_id = req.user.id;
  try {
    const { data: requests } = await RequestModel.getRequestIdsByUser(user_id);
    if (!requests || requests.length === 0) return res.json({ success: true, members: [] });
    const { data: members } = await RequestModel.getMembersByRequestIds(requests.map(r => r.id));
    res.json({ success: true, members: deduplicateMembers(members) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ─── UPDATE MEMBER ──────────────────────────────────────────────────
export const updateMember = async (req, res) => {
  const { id } = req.params;
  const { name, contact, email, pradesh } = req.body;
  const user_id = req.user.id;

  try {
    const { data: member } = await RequestModel.getMemberById(id);
    if (!member || member.requests.user_id !== user_id) {
      return res.status(403).json({ error: "Access denied" });
    }
    const { data: userRequests } = await RequestModel.getRequestIdsByUser(user_id);
    const { error } = await RequestModel.updateMembersByIdentity(
      userRequests.map(r => r.id), member, { name, contact, email, pradesh }
    );
    if (error) throw error;
    res.json({ success: true, message: "Member updated successfully" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ─── DELETE MEMBER (SOFT) ───────────────────────────────────────────
export const deleteMember = async (req, res) => {
  const { id } = req.params;
  const user_id = req.user.id;
  try {
    const { data: member } = await RequestModel.getMemberById(id);
    if (!member || member.requests.user_id !== user_id) {
      return res.status(403).json({ error: "Access denied" });
    }
    const { data: userRequests } = await RequestModel.getRequestIdsByUser(user_id);
    const { error } = await RequestModel.softDeleteMembersByIdentity(
      userRequests.map(r => r.id), member
    );
    if (error) throw error;
    res.json({ success: true, message: "Member record removed" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ─── CREATE REQUEST ─────────────────────────────────────────────────
export const createRequest = async (req, res) => {
  const { request_name, check_in, check_out, total_people, notes, status, members } = req.body;
  const user_id = req.user.id;

  if (!check_in || !check_out || !total_people || !members || !Array.isArray(members)) {
    return res.status(400).json({ error: "Missing required fields or invalid members array" });
  }

  try {
    const { data: userProfile } = await UserModel.findUserById(user_id, "pradesh");
    const userPradesh = userProfile?.pradesh || null;

    const { data: requestData, error: requestError } = await RequestModel.createRequest({
      user_id, request_name: request_name || null, check_in, check_out,
      total_people, notes: notes || null, status: status || undefined
    });
    if (requestError) return res.status(400).json({ error: requestError.message });

    const membersData = members.map(m => ({
      request_id: requestData.id, name: m.name,
      contact: m.contact || null, pradesh: m.pradesh || userPradesh, email: m.email || null
    }));

    const { error: membersError } = await RequestModel.insertRequestMembers(membersData);
    if (membersError) {
      return res.status(400).json({ error: "Request created but failed to add members: " + membersError.message, requestId: requestData.id });
    }

    // Send confirmation email
    try {
      const { data: userData } = await UserModel.findUserById(user_id, "email");
      if (userData?.email) await sendRequestConfirmationEmail(userData.email, requestData);
    } catch (emailErr) { console.error("Failed to send confirmation email:", emailErr); }

    // PubSub notification
    try {
      const userName = req.user.name || req.user.email || "A user";
      await sendPubSubNotification("admin-notifications", "new_request", {
        requestId: requestData.id, userName, user_name: userName,
        requestName: request_name || "Accommodation Request", request_name: request_name || "Accommodation Request",
        totalPeople: total_people
      });
    } catch (pubSubErr) { console.error("Failed to send PubSub notification:", pubSubErr); }

    res.status(201).json({ success: true, message: "Request and members successfully created.", request: requestData });
  } catch (error) {
    console.error("Error creating request:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

// ─── GET MY REQUESTS ────────────────────────────────────────────────
export const getMyRequests = async (req, res) => {
  const user_id = req.user.id;
  try {
    const { data: requests, error } = await RequestModel.getUserRequests(user_id);
    if (error) return res.status(400).json({ error: error.message });

    const result = [];
    for (let reqItem of requests) {
      let allocationData = null;
      const normalizedStatus = (reqItem.status || "").toString().toUpperCase();
      const isProcessed = normalizedStatus === "ACCEPTED" || normalizedStatus.startsWith("APPROVED");

      if (isProcessed) {
        const { data: allocation } = await supabase.from("allocations").select("*").eq("request_id", reqItem.id).maybeSingle();
        if (allocation) {
          const { data: items } = await supabase.from("allocation_items").select(`id, room_id, house_id, assigned_capacity, rooms (*), houses (*), member_allocations (id, request_member_id, request_members (*))`).eq("allocation_id", allocation.id);
          allocationData = { ...allocation, items: items || [] };
        }
      }
      result.push({ ...reqItem, allocation: allocationData });
    }
    res.json({ success: true, requests: result });
  } catch (error) {
    console.error("Fetch requests error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

// ─── UPDATE OWN PENDING REQUEST ─────────────────────────────────────
export const updateMyRequest = async (req, res) => {
  const { id } = req.params;
  const user_id = req.user.id;
  const { check_in, check_out, total_people, notes, members } = req.body;

  if (!check_in || !check_out || !total_people || !Array.isArray(members)) {
    return res.status(400).json({ error: "Missing required fields or invalid members array" });
  }

  try {
    const { data: existing, error: fetchError } = await RequestModel.getRequestByIdAndUser(id, user_id);
    if (fetchError || !existing) return res.status(404).json({ error: "Request not found" });
    if ((existing.status || "PENDING").toUpperCase() !== "PENDING") {
      return res.status(403).json({ error: "Only pending requests can be edited" });
    }

    const { data: userProfile } = await UserModel.findUserById(user_id, "pradesh");
    const userPradesh = userProfile?.pradesh || null;

    const { data: requestData, error: requestError } = await RequestModel.updateRequest(id, { check_in, check_out, total_people, notes: notes || null }, user_id);
    if (requestError) return res.status(400).json({ error: requestError.message });

    await RequestModel.deleteRequestMembers(id);

    const membersData = members.filter(m => m && m.name).map(m => ({
      request_id: id, name: m.name, contact: m.contact || null,
      pradesh: m.pradesh || userPradesh, email: m.email || null
    }));
    if (membersData.length === 0) return res.status(400).json({ error: "Please add at least one member" });

    const { error: membersError } = await RequestModel.insertRequestMembers(membersData);
    if (membersError) return res.status(400).json({ error: membersError.message });

    res.json({ success: true, message: "Request updated successfully", request: requestData });
  } catch (error) {
    console.error("Update request error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

// ─── UPLOAD MEMBERS VIA EXCEL ───────────────────────────────────────
export const uploadMembersExcel = async (req, res) => {
  const { id: requestId } = req.params;
  if (!req.file) return res.status(400).json({ error: "Please upload an Excel or CSV file" });

  try {
    const workbook = xlsx.read(req.file.buffer, { type: "buffer" });
    const rows = xlsx.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]]);
    if (rows.length === 0) return res.status(400).json({ error: "The uploaded file is empty" });

    const findVal = (row, key) => {
      const foundKey = Object.keys(row).find(k => k.toLowerCase() === key.toLowerCase());
      return foundKey ? row[foundKey] : null;
    };

    const membersData = rows.map(row => ({
      request_id: requestId, name: findVal(row, "name"),
      contact: findVal(row, "contact")?.toString() || null,
      pradesh: findVal(row, "pradesh") || null, email: findVal(row, "email") || null
    })).filter(m => m.name);

    if (membersData.length === 0) return res.status(400).json({ error: "No valid member data found" });

    const { error } = await RequestModel.insertRequestMembers(membersData);
    if (error) return res.status(400).json({ error: "Failed to upload members: " + error.message });

    res.json({ success: true, message: `Successfully uploaded ${membersData.length} members`, count: membersData.length });
  } catch (error) {
    console.error("Excel Upload Error:", error);
    res.status(500).json({ error: "Failed to process the Excel file" });
  }
};

// ─── FORWARD BOOKING DETAILS TO MEMBERS ─────────────────────────────
export const forwardToMembers = async (req, res) => {
  const { id: requestId } = req.params;
  const { member_ids } = req.body;
  if (!Array.isArray(member_ids) || member_ids.length === 0) {
    return res.status(400).json({ error: "Please select at least one member to forward to" });
  }

  try {
    const { data: request, error: reqError } = await RequestModel.getRequestForForward(requestId);
    if (reqError) return res.status(500).json({ error: "Database error: " + reqError.message });
    if (!request) return res.status(404).json({ error: "Request not found" });
    if (req.user.role !== "ADMIN" && request.user_id !== req.user.id) {
      return res.status(403).json({ error: "You do not have permission to forward this request" });
    }
    if (request.status !== "ACCEPTED") return res.status(400).json({ error: "Booking is not yet approved" });

    const recipients = request.request_members.filter(m => member_ids.includes(m.id));
    if (recipients.length === 0) return res.status(400).json({ error: "No valid members found to email" });

    let sentCount = 0;
    const requester = request.users || {};

    for (const member of recipients) {
      if (!member.email) continue;
      let location = "Not assigned yet";
      if (request.allocations) {
        const allocArray = Array.isArray(request.allocations) ? request.allocations : [request.allocations];
        for (const alloc of allocArray) {
          if (!alloc.allocation_items) continue;
          for (const item of alloc.allocation_items) {
            if (!item.member_allocations) continue;
            if (item.member_allocations.some(ma => ma.request_member_id === member.id)) {
              location = item.rooms ? `Room ${item.rooms.room_number}` : (item.houses ? `House ${item.houses.owner_name}` : "Assigned");
              break;
            }
          }
          if (location !== "Not assigned yet") break;
        }
      }
      await sendMemberBookingEmail(member.email, member.name, {
        location, check_in: request.check_in, check_out: request.check_out,
        requesterName: requester.name || "N/A", requesterEmail: requester.email || "N/A",
        requesterPhone: requester.phone || "N/A", allMembers: request.request_members
      });
      sentCount++;
    }
    res.json({ success: true, message: `Details forwarded to ${sentCount} members` });
  } catch (error) {
    console.error("Forwarding Error:", error);
    res.status(500).json({ error: "Failed to forward details: " + error.message });
  }
};

// ─── DELETE / CANCEL REQUEST ────────────────────────────────────────
export const deleteRequest = async (req, res) => {
  const { id: requestId } = req.params;
  const user_id = req.user.id;
  try {
    const { data: request, error: fetchError } = await RequestModel.getRequestById(requestId);
    if (fetchError || !request) return res.status(404).json({ error: "Request not found" });
    if (req.user.role !== "ADMIN" && request.user_id !== user_id) {
      return res.status(403).json({ error: "You do not have permission to delete this request" });
    }

    await supabase.from("room_bookings").delete().eq("request_id", requestId);
    await supabase.from("house_bookings").delete().eq("request_id", requestId);

    const { error } = await RequestModel.updateRequest(requestId, {
      status: "CANCELLED", notes: `[DELETED] ${request.notes || ""}`.trim()
    });
    if (error) throw error;

    res.json({ success: true, message: "Request cancelled and resources released" });
  } catch (error) {
    console.error("Delete Request Error:", error);
    res.status(500).json({ error: error.message });
  }
};
