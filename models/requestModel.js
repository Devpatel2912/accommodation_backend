import { supabase } from "../config/supabase.js";

// ─── Create request ─────────────────────────────────────────────────
export const createRequest = async (requestData) => {
  const { data, error } = await supabase
    .from("requests")
    .insert([requestData])
    .select()
    .single();
  return { data, error };
};

// ─── Get user's requests with nested data ───────────────────────────
export const getUserRequests = async (userId) => {
  const { data, error } = await supabase
    .from("requests")
    .select(`
      *,
      request_members (*, pradesh(name)),
      house_bookings (
        *,
        houses (*)
      )
    `)
    .eq("user_id", userId)
    .order("created_at", { ascending: false });
  return { data, error };
};

// ─── Get single request by ID and user ──────────────────────────────
export const getRequestByIdAndUser = async (id, userId) => {
  const { data, error } = await supabase
    .from("requests")
    .select("id, status")
    .eq("id", id)
    .eq("user_id", userId)
    .single();
  return { data, error };
};

// ─── Update request ─────────────────────────────────────────────────
export const updateRequest = async (id, updates, userId = null) => {
  let query = supabase.from("requests").update(updates).eq("id", id);
  if (userId) query = query.eq("user_id", userId);
  const { data, error } = await query.select().single();
  return { data, error };
};

// ─── Get request by ID ──────────────────────────────────────────────
export const getRequestById = async (id) => {
  const { data, error } = await supabase
    .from("requests")
    .select("*")
    .eq("id", id)
    .single();
  return { data, error };
};

// ─── Get all requests with full nested data (admin) ─────────────────
export const getAllRequestsWithNested = async () => {
  const { data, error } = await supabase
    .from("requests")
    .select(`
      *,
      request_members (*, pradesh(name)),
      house_bookings (
        *,
        houses (*)
      ),
      allocations (
        *,
        allocation_items (
          *,
          member_allocations (*),
          rooms (*),
          houses (*)
        )
      )
    `)
    .order("created_at", { ascending: false });
  return { data, error };
};

// ─── Get single request with full nested data (admin) ───────────────
export const getRequestWithNested = async (id) => {
  const { data, error } = await supabase
    .from("requests")
    .select(`
      *,
      request_members (*, pradesh(name)),
      house_bookings (
        *,
        houses (*)
      ),
      allocations (
        *,
        allocation_items (
          *,
          rooms (*),
          houses (*),
          member_allocations (*)
        )
      )
    `)
    .eq("id", id)
    .single();
  return { data, error };
};

// ─── Get request with full data for forwarding ──────────────────────
export const getRequestForForward = async (id) => {
  const { data, error } = await supabase
    .from("requests")
    .select(`
      *,
      users (name, email, phone),
      request_members (*, pradesh(name)),
      allocations (
        *,
        allocation_items (
          *,
          rooms (room_number),
          houses (owner_name),
          member_allocations (*)
        )
      )
    `)
    .eq("id", id)
    .single();
  return { data, error };
};

// ─── Request Members ────────────────────────────────────────────────

export const insertRequestMembers = async (membersData) => {
  const { error } = await supabase
    .from("request_members")
    .insert(membersData);
  return { error };
};

export const deleteRequestMembers = async (requestId) => {
  const { error } = await supabase
    .from("request_members")
    .delete()
    .eq("request_id", requestId);
  return { error };
};

export const getRequestIdsByUser = async (userId) => {
  const { data, error } = await supabase
    .from("requests")
    .select("id")
    .eq("user_id", userId);
  return { data, error };
};

export const getMembersByRequestIds = async (requestIds) => {
  const { data, error } = await supabase
    .from("request_members")
    .select("*, pradesh(name)")
    .in("request_id", requestIds);
  return { data, error };
};

export const getMemberById = async (id) => {
  const { data, error } = await supabase
    .from("request_members")
    .select("*, requests(user_id), pradesh(name)")
    .eq("id", id)
    .single();
  return { data, error };
};

export const updateMembersByIdentity = async (requestIds, oldMember, newData) => {
  const { error } = await supabase
    .from("request_members")
    .update(newData)
    .in("request_id", requestIds)
    .eq("name", oldMember.name)
    .eq("contact", oldMember.contact)
    .eq("email", oldMember.email);
  return { error };
};

export const softDeleteMembersByIdentity = async (requestIds, member) => {
  const { error } = await supabase
    .from("request_members")
    .update({ pradesh: "DELETED" })
    .in("request_id", requestIds)
    .eq("name", member.name)
    .eq("contact", member.contact)
    .eq("email", member.email);
  return { error };
};

export const getAllMembers = async () => {
  const { data, error } = await supabase
    .from("request_members")
    .select("*")
    .order("name", { ascending: true });
  return { data, error };
};

export const getMemberByIdSimple = async (id) => {
  const { data, error } = await supabase
    .from("request_members")
    .select("*")
    .eq("id", id)
    .single();
  return { data, error };
};

export const updateMembersByOldIdentity = async (oldMember, newData) => {
  const { error } = await supabase
    .from("request_members")
    .update(newData)
    .eq("name", oldMember.name)
    .eq("contact", oldMember.contact)
    .eq("email", oldMember.email);
  return { error };
};

export const softDeleteMemberById = async (id) => {
  const { error } = await supabase
    .from("request_members")
    .update({ pradesh: "DELETED" })
    .eq("id", id);
  return { error };
};

export const getRequestMembersByRequestId = async (requestId) => {
  const { data, error } = await supabase
    .from("request_members")
    .select("id")
    .eq("request_id", requestId);
  return { data, error };
};
