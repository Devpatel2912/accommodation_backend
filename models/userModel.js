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
    .select("*, pradesh(name)")
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
    .select("id, name")
    .order("name", { ascending: true });

  if (!tableError && tableData && tableData.length > 0) {
    return tableData;
  }

  // Fallback if table fails or is empty, returning dummy IDs for old data is problematic
  // but we can just return empty or rely on the table since it's being created.
  return [];
};
