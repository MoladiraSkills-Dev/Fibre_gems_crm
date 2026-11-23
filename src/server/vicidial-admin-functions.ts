import { createServerFn } from "@tanstack/react-start";
import { getCurrentUser } from "./auth";
import { backendFetch } from "./admin-functions";

// ----------------------------------------------------
// Server-side proxies to the FastAPI VICIdial admin API.
// All functions require an admin CRM user; telephony data is
// read from VICIdial's MariaDB via the backend.
// ----------------------------------------------------

function requireAdmin(user: { id: string; role: string } | null) {
  if (!user) throw new Error("Unauthorized");
  if (user.role !== "admin") throw new Error("Admin access required");
  return user;
}

async function vici<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await backendFetch<T>(`/api/v1/admin/vicidial${path}`, options);
  if (res === null) {
    throw new Error("VICIdial backend unreachable or rejected the request");
  }
  return res;
}

export type VicidialPhone = {
  extension: string;
  dialplan_number: string | null;
  voicemail_id: string | null;
  server_ip: string;
  login: string;
  pass: string | null;
  status: string | null;
  active: string | null;
  phone_type: string | null;
  fullname: string | null;
  protocol: string | null;
  local_gmt: string | null;
  phone_context: string | null;
  outbound_cid: string | null;
  email: string | null;
};

export type VicidialUser = {
  user: string;
  full_name: string | null;
  user_level: number | null;
  user_group: string | null;
  phone_login: string | null;
  active: string | null;
  ast_admin_access: string | null;
  modify_users: string | null;
  delete_users: string | null;
  load_leads: string | null;
  vicidial_recording: string | null;
};

export type VicidialCarrier = {
  carrier_id: string;
  carrier_name: string | null;
  registration_string: string | null;
  template_id: string | null;
  account_entry: string | null;
  protocol: string | null;
  globals_string: string | null;
  dialplan_entry: string | null;
  server_ip: string | null;
  active: string | null;
  carrier_description: string | null;
  user_group: string | null;
};

export type VicidialList = {
  list_id: string;
  list_name: string | null;
  campaign_id: string | null;
  active: string | null;
  list_description: string | null;
  reset_time: string | null;
  local_call_time: string | null;
  lead_count: number;
};

export type VicidialCall = {
  uniqueid: string;
  lead_id: string | null;
  list_id: string | null;
  campaign_id: string | null;
  call_date: string | null;
  length_in_sec: number | null;
  status: string | null;
  phone_number: string | null;
  phone_code: string | null;
  user: string | null;
  term_reason: string | null;
  comments: string | null;
  processed: string | null;
  source?: "CRM" | "VICIDIAL";
  recording_ref?: string | null;
};

export type VicidialRecording = {
  recording_id: string;
  channel: string | null;
  server_ip: string | null;
  extension: string | null;
  start_time: string | null;
  end_time: string | null;
  length_in_sec: number | null;
  filename: string | null;
  location: string | null;
  lead_id: string | null;
  user: string | null;
  source?: "CRM" | "VICIDIAL";
  play_ref?: string | null;
};

export type VicidialLiveAgent = {
  user: string;
  status: string | null;
  lead_id: string | null;
  campaign_id: string | null;
  uniqueid: string | null;
  callerid: string | null;
  extension: string | null;
  last_call_time: string | null;
  last_update_time: string | null;
  calls_today: number | null;
  full_name: string | null;
  user_level: number | null;
  user_group: string | null;
  source?: "CRM" | "VICIDIAL" | "BOTH";
  crm_online?: boolean | null;
  vicidial_status?: string | null;
  seconds_in_state?: number;
  pause_code?: string | null;
};

export type VicidialOverview = {
  phones: number;
  users: number;
  campaigns: number;
  lists: number;
  leads: number;
  live_agents: number;
  calls_today: number;
};

export const getVicidialOverviewFn = createServerFn({ method: "GET" }).handler(
  async () => {
    requireAdmin(await getCurrentUser());
    return vici<VicidialOverview>("/overview");
  },
);

export const getVicidialPhonesFn = createServerFn({ method: "GET" }).handler(
  async () => {
    requireAdmin(await getCurrentUser());
    const res = await vici<{ phones: VicidialPhone[] }>("/phones");
    return res.phones;
  },
);

export type PhoneUpdateInput = {
  extension: string;
  server_ip?: string;
  delete_phone?: string;
  phone_login?: string;
  phone_pass?: string;
  dialplan_number?: string;
  voicemail_id?: string;
  protocol?: string;
  registration_password?: string;
  phone_full_name?: string;
  local_gmt?: string;
  phone_context?: string;
  email?: string;
};

export const updateVicidialPhoneFn = createServerFn({ method: "POST" })
  .validator((data: PhoneUpdateInput) => {
    if (!data?.extension) throw new Error("Extension is required");
    return data;
  })
  .handler(async ({ data }) => {
    requireAdmin(await getCurrentUser());
    const res = await vici<{ success: boolean; response: string }>("/phones/update", {
      method: "POST",
      body: JSON.stringify(data),
    });
    return res;
  });

export const getVicidialUsersFn = createServerFn({ method: "GET" }).handler(async () => {
  requireAdmin(await getCurrentUser());
  const res = await vici<{ users: VicidialUser[] }>("/users");
  return res.users;
});

export const getVicidialCarriersFn = createServerFn({ method: "GET" }).handler(async () => {
  requireAdmin(await getCurrentUser());
  const res = await vici<{ carriers: VicidialCarrier[] }>("/carriers");
  return res.carriers;
});

export type CarrierInput = {
  carrier_id: string;
  carrier_name: string;
  server_ip: string;
  protocol?: string;
  registration_string?: string;
  template_id?: string;
  account_entry?: string;
  globals_string?: string;
  dialplan_entry?: string;
  carrier_description?: string;
  user_group?: string;
  active?: string;
};

export const createVicidialCarrierFn = createServerFn({ method: "POST" })
  .validator((data: CarrierInput) => {
    if (!data?.carrier_id?.trim()) throw new Error("Carrier ID is required");
    if (!data?.carrier_name?.trim()) throw new Error("Carrier name is required");
    if (!data?.server_ip?.trim()) throw new Error("Server IP is required");
    return data;
  })
  .handler(async ({ data }) => {
    requireAdmin(await getCurrentUser());
    return vici<{ success: boolean }>("/carriers", {
      method: "POST",
      body: JSON.stringify(data),
    });
  });

export const updateVicidialCarrierFn = createServerFn({ method: "POST" })
  .validator((data: { carrier_id: string } & Partial<CarrierInput>) => {
    if (!data?.carrier_id) throw new Error("Carrier ID is required");
    return data;
  })
  .handler(async ({ data }) => {
    requireAdmin(await getCurrentUser());
    const { carrier_id, ...fields } = data;
    return vici<{ success: boolean }>(`/carriers/${encodeURIComponent(carrier_id)}`, {
      method: "PUT",
      body: JSON.stringify(fields),
    });
  });

export const deleteVicidialCarrierFn = createServerFn({ method: "POST" })
  .validator((data: { carrier_id: string }) => {
    if (!data?.carrier_id) throw new Error("Carrier ID is required");
    return data;
  })
  .handler(async ({ data }) => {
    requireAdmin(await getCurrentUser());
    return vici<{ success: boolean }>(`/carriers/${encodeURIComponent(data.carrier_id)}`, {
      method: "DELETE",
    });
  });

export const getVicidialPauseCodesFn = createServerFn({ method: "GET" }).handler(async () => {
  requireAdmin(await getCurrentUser());
  const res = await vici<{ pause_codes: Array<Record<string, string | number | null>> }>("/pause-codes");
  return res.pause_codes;
});

export const getVicidialListsFn = createServerFn({ method: "GET" }).handler(async () => {
  requireAdmin(await getCurrentUser());
  const res = await vici<{ lists: VicidialList[] }>("/lists");
  return res.lists;
});

export const getVicidialDncFn = createServerFn({ method: "GET" }).handler(async () => {
  requireAdmin(await getCurrentUser());
  const res = await vici<{ dnc: string[] }>("/dnc");
  return res.dnc;
});

export const addVicidialDncFn = createServerFn({ method: "POST" })
  .validator((data: { phone_number: string }) => {
    if (!data?.phone_number?.trim()) throw new Error("Phone number is required");
    return data;
  })
  .handler(async ({ data }) => {
    requireAdmin(await getCurrentUser());
    return vici<{ success: boolean }>("/dnc", {
      method: "POST",
      body: JSON.stringify(data),
    });
  });

export const removeVicidialDncFn = createServerFn({ method: "POST" })
  .validator((data: { phone_number: string }) => {
    if (!data?.phone_number) throw new Error("Phone number is required");
    return data;
  })
  .handler(async ({ data }) => {
    requireAdmin(await getCurrentUser());
    return vici<{ success: boolean }>(`/dnc/${encodeURIComponent(data.phone_number)}`, {
      method: "DELETE",
    });
  });

export const getVicidialCallsFn = createServerFn({ method: "GET" })
  .validator((data?: { campaign_id?: string; limit?: number }) => data ?? {})
  .handler(async ({ data }) => {
    requireAdmin(await getCurrentUser());
    const qs = new URLSearchParams();
    if (data.campaign_id) qs.set("campaign_id", data.campaign_id);
    if (data.limit) qs.set("limit", String(data.limit));
    const res = await vici<{ calls: VicidialCall[] }>(`/calls?${qs.toString()}`);
    return res.calls;
  });

export const getVicidialRecordingsFn = createServerFn({ method: "GET" })
  .validator((data?: { limit?: number }) => data ?? {})
  .handler(async ({ data }) => {
    requireAdmin(await getCurrentUser());
    const qs = data.limit ? `?limit=${data.limit}` : "";
    const res = await vici<{ recordings: VicidialRecording[] }>(`/recordings${qs}`);
    return res.recordings;
  });

export const getVicidialLiveAgentsFn = createServerFn({ method: "GET" }).handler(async () => {
  requireAdmin(await getCurrentUser());
  const res = await vici<{ agents: VicidialLiveAgent[] }>("/live-agents");
  return res.agents;
});

// ----------------------------------------------------
// Mutations: phones, users, pause codes, recording playback
// ----------------------------------------------------

export type PhoneCreateInput = {
  extension: string;
  phone_full_name?: string;
  phone_login?: string;
  phone_pass?: string;
  dialplan_number?: string;
  voicemail_id?: string;
  protocol?: string;
  local_gmt?: string;
  outbound_cid?: string;
  phone_context?: string;
  server_ip?: string;
};

export const createVicidialPhoneFn = createServerFn({ method: "POST" })
  .validator((data: PhoneCreateInput) => {
    if (!data?.extension?.trim()) throw new Error("Extension is required");
    return data;
  })
  .handler(async ({ data }) => {
    requireAdmin(await getCurrentUser());
    return vici<{ success: boolean; response: string; sip_password?: string }>("/phones", {
      method: "POST",
      body: JSON.stringify(data),
    });
  });

export type VicidialUserInput = {
  agent_user: string;
  agent_pass: string;
  agent_user_level?: number;
  agent_full_name?: string;
  agent_user_group?: string;
  phone_login?: string;
  phone_pass?: string;
  email?: string;
};

export const createVicidialUserFn = createServerFn({ method: "POST" })
  .validator((data: VicidialUserInput) => {
    if (!data?.agent_user?.trim()) throw new Error("Username is required");
    if (!data?.agent_pass) throw new Error("Password is required");
    return data;
  })
  .handler(async ({ data }) => {
    requireAdmin(await getCurrentUser());
    return vici<{ success: boolean; response: string }>("/users", {
      method: "POST",
      body: JSON.stringify(data),
    });
  });

export type VicidialUserUpdateInput = {
  user: string;
  full_name?: string;
  phone_login?: string;
  pass_?: string;
  user_level?: number;
  user_group?: string;
  active?: string;
};

export const updateVicidialUserFn = createServerFn({ method: "POST" })
  .validator((data: VicidialUserUpdateInput) => {
    if (!data?.user) throw new Error("User is required");
    return data;
  })
  .handler(async ({ data }) => {
    requireAdmin(await getCurrentUser());
    const { user, ...fields } = data;
    return vici<{ success: boolean }>(`/users/${encodeURIComponent(user)}`, {
      method: "PUT",
      body: JSON.stringify(fields),
    });
  });

export const deleteVicidialUserFn = createServerFn({ method: "POST" })
  .validator((data: { user: string }) => {
    if (!data?.user) throw new Error("User is required");
    return data;
  })
  .handler(async ({ data }) => {
    requireAdmin(await getCurrentUser());
    return vici<{ success: boolean }>(`/users/${encodeURIComponent(data.user)}`, {
      method: "DELETE",
    });
  });

export type PauseCodeInput = {
  pause_code: string;
  pause_code_name?: string;
  billable?: string;
  campaign_id?: string;
  time_limit?: string;
  require_mgr_approval?: string;
};

export const createVicidialPauseCodeFn = createServerFn({ method: "POST" })
  .validator((data: PauseCodeInput) => {
    if (!data?.pause_code?.trim()) throw new Error("Pause code is required");
    return data;
  })
  .handler(async ({ data }) => {
    requireAdmin(await getCurrentUser());
    return vici<{ success: boolean }>("/pause-codes", {
      method: "POST",
      body: JSON.stringify(data),
    });
  });

export const updateVicidialPauseCodeFn = createServerFn({ method: "POST" })
  .validator((data: { pause_code: string } & Partial<PauseCodeInput>) => {
    if (!data?.pause_code) throw new Error("Pause code is required");
    return data;
  })
  .handler(async ({ data }) => {
    requireAdmin(await getCurrentUser());
    const { pause_code, ...fields } = data;
    return vici<{ success: boolean }>(`/pause-codes/${encodeURIComponent(pause_code)}`, {
      method: "PUT",
      body: JSON.stringify(fields),
    });
  });

export const deleteVicidialPauseCodeFn = createServerFn({ method: "POST" })
  .validator((data: { pause_code: string }) => {
    if (!data?.pause_code) throw new Error("Pause code is required");
    return data;
  })
  .handler(async ({ data }) => {
    requireAdmin(await getCurrentUser());
    return vici<{ success: boolean }>(`/pause-codes/${encodeURIComponent(data.pause_code)}`, {
      method: "DELETE",
    });
  });

export const getRecordingPlayUrlFn = createServerFn({ method: "GET" })
  .validator((data: { ref: string }) => {
    if (!data?.ref) throw new Error("Recording ref is required");
    return data;
  })
  .handler(async ({ data }) => {
    requireAdmin(await getCurrentUser());
    const res = await vici<{ url: string; expires_in: number }>(
      `/recordings/play-url?ref=${encodeURIComponent(data.ref)}`,
    );
    return res.url;
  });
