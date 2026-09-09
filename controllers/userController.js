import * as UserModel from "../models/userModel.js";

export const createUser = async (req, res) => {
  const { name, email, phone, role, pradesh, pradesh_id, sub_admin_type } = req.body;
  // Fallback to storing string if no ID provided, but preferably store pradesh_id
  const userData = { name, email, phone, role, pradesh, pradesh_id };
  if (role?.toUpperCase() === "SUBADMIN" && sub_admin_type) {
    userData.sub_admin_type = sub_admin_type.toUpperCase();
  }
  const { data, error } = await UserModel.createUser(userData);
  if (error) return res.status(400).json({ error: error.message });
  res.json({ success: true, user: data });
};

export const getAllUsers = async (req, res) => {
  const { data, error } = await UserModel.getAllUsers();
  if (error) return res.status(400).json({ error: error.message });
  res.json({ success: true, users: data });
};

export const getUserById = async (req, res) => {
  const { data, error } = await UserModel.findUserById(req.params.id);
  if (error || !data) return res.status(404).json({ error: "User not found" });
  res.json({ success: true, user: data });
};

export const getUserMembers = async (req, res) => {
  const { id } = req.params;
  try {
    const { data: requests, error: reqError } = await UserModel.findUserById(id); // just validate user exists
    if (reqError) throw reqError;

    const { supabase } = await import("../config/supabase.js");
    const { data: reqs } = await supabase.from("requests").select("id").eq("user_id", id);
    if (!reqs || reqs.length === 0) return res.json({ success: true, members: [] });

    const { data: members, error: memError } = await supabase.from("request_members").select("*").in("request_id", reqs.map(r => r.id)).order("name", { ascending: true });
    if (memError) throw memError;

    const unique = [], seen = new Set();
    members.forEach(m => {
      const key = `${m.name}-${m.contact}-${m.email}`.toLowerCase();
      if (!seen.has(key)) { seen.add(key); unique.push(m); }
    });
    res.json({ success: true, members: unique });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

export const updateUser = async (req, res) => {
  const { data, error } = await UserModel.updateUser(req.params.id, req.body);
  if (error) return res.status(400).json({ error: error.message });
  res.json({ success: true, user: data });
};

export const deleteUser = async (req, res) => {
  try {
    const { error } = await UserModel.softDeleteUser(req.params.id);
    if (error) throw error;
    res.json({ success: true, message: "User soft-deleted" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
