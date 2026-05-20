import { supabase } from "../config/supabase.js";

// ─── Find user by email ─────────────────────────────────────────────
export const findUserByEmail = async (email) => {
  const { data, error } = await supabase
    .from("users")
    .select("*")
    .eq("email", email)
    .single();
  return { data, error };
};

// ─── Find user by ID ────────────────────────────────────────────────
export const findUserById = async (id, fields = "*") => {
  const { data, error } = await supabase
    .from("users")
    .select(fields)
    .eq("id", id)
    .single();
  return { data, error };
};

// ─── Check if email already exists ──────────────────────────────────
export const findUserByEmailMaybe = async (email) => {
  const { data, error } = await supabase
    .from("users")
    .select("id")
    .eq("email", email)
    .maybeSingle();
  return { data, error };
};

// ─── Create user ────────────────────────────────────────────────────
export const createUser = async (userData) => {
  const { data, error } = await supabase
    .from("users")
    .insert([userData])
    .select()
    .single();
  return { data, error };
};

// ─── Get all users ──────────────────────────────────────────────────
export const getAllUsers = async () => {
  const { data, error } = await supabase
    .from("users")
    .select("*")
    .order("id", { ascending: true });
  return { data, error };
};

// ─── Update user ────────────────────────────────────────────────────
export const updateUser = async (id, updates) => {
  const { data, error } = await supabase
    .from("users")
    .update(updates)
    .eq("id", id)
    .select()
    .single();
  return { data, error };
};

// ─── Soft-delete user (set role to null) ────────────────────────────
export const softDeleteUser = async (id) => {
  const { error } = await supabase
    .from("users")
    .update({ role: null })
    .eq("id", id);
  return { error };
};

// ─── Get pradesh list from dedicated table or fallback ──────────────
export const getPradeshList = async () => {
  const { data: tableData, error: tableError } = await supabase
    .from("pradesh")
    .select("name");

  if (!tableError && tableData && tableData.length > 0) {
    return tableData.map(p => p.name).sort();
  }

  // Fallback: aggregate from users + request_members
  const { data: userData } = await supabase.from("users").select("pradesh");
  const { data: memberData } = await supabase.from("request_members").select("pradesh");

  const set = new Set();
  if (userData) userData.forEach(u => u.pradesh && set.add(u.pradesh));
  if (memberData) memberData.forEach(m => m.pradesh && set.add(m.pradesh));

  return Array.from(set).sort();
};
