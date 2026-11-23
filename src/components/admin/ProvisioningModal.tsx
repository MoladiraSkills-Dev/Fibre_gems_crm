import { useEffect, useState, type FormEvent } from "react";
import { Copy, Eye, EyeOff, Phone, UserCog } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  createAgentFn,
  updateAgentFn,
  type AdminAgentRow,
} from "@/server/admin-functions";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editingAgent: AdminAgentRow | null;
  onSaved: () => void;
};

const ROLE_LABELS: Record<string, string> = {
  agent: "Agent (agt)",
  team_leader: "Team Leader (tml)",
  admin: "Administrator (adm)",
};

const ROLE_PREFIX: Record<string, string> = {
  agent: "agt",
  team_leader: "tml",
  admin: "adm",
};

export function ProvisioningModal({ open, onOpenChange, editingAgent, onSaved }: Props) {
  const isEdit = Boolean(editingAgent);
  const [busy, setBusy] = useState(false);
  const [showPass, setShowPass] = useState(false);
  const [showPhonePass, setShowPhonePass] = useState(false);
  const [isActive, setIsActive] = useState(true);

  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<"agent" | "team_leader" | "admin">("agent");
  const [agentCode, setAgentCode] = useState("");
  const [phoneLogin, setPhoneLogin] = useState("");
  const [phonePass, setPhonePass] = useState("");

  const handleRoleChange = (newRole: "agent" | "team_leader" | "admin") => {
    setRole(newRole);
    if (!isEdit) {
      const newPrefix = ROLE_PREFIX[newRole];
      const cleanExt = phoneLogin.replace(/\D/g, "");
      if (!agentCode || /^(agt|tml|adm)\d*$/i.test(agentCode)) {
        setAgentCode(cleanExt ? `${newPrefix}${cleanExt}` : "");
      }
    }
  };

  const handlePhoneLoginChange = (newPhone: string) => {
    setPhoneLogin(newPhone);
    if (!isEdit) {
      const cleanExt = newPhone.replace(/\D/g, "");
      const prefix = ROLE_PREFIX[role];
      if (!agentCode || /^(agt|tml|adm)\d*$/i.test(agentCode)) {
        setAgentCode(cleanExt ? `${prefix}${cleanExt}` : "");
      }
    }
  };

  useEffect(() => {
    if (open) {
      if (editingAgent) {
        setFullName(editingAgent.full_name);
        setEmail(editingAgent.email);
        setPassword("");
        setRole(editingAgent.role);
        setAgentCode(editingAgent.agent_code ?? "");
        setPhoneLogin(editingAgent.phone_login ?? "");
        setPhonePass(editingAgent.phone_pass ?? "");
        setIsActive(editingAgent.status === "active");
        setShowPass(false);
        setShowPhonePass(false);
      } else {
        setFullName("");
        setEmail("");
        setPassword("");
        setRole("agent");
        setAgentCode("");
        setPhoneLogin("");
        setPhonePass("");
        setIsActive(true);
        setShowPass(false);
        setShowPhonePass(false);
      }
    }
  }, [open, editingAgent]);

  const copyToClipboard = (text: string, label: string) => {
    if (!text) return;
    void navigator.clipboard.writeText(text);
    toast.success(`${label} copied to clipboard`);
  };

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);

    try {
      if (isEdit && editingAgent) {
        await updateAgentFn({
          data: {
            id: editingAgent.id,
            full_name: fullName,
            email,
            agent_code: agentCode || null,
            phone_login: phoneLogin || null,
            phone_pass: phonePass || null,
            status: isActive ? "active" : "suspended",
            role,
            ...(password ? { password } : {}),
          },
        });
        toast.success("Agent updated successfully");
      } else {
        if (!password || password.length < 6) {
          toast.error("Password must be at least 6 characters");
          setBusy(false);
          return;
        }
        await createAgentFn({
          data: {
            full_name: fullName,
            email,
            password,
            role,
            agent_code: agentCode || undefined,
            phone_login: phoneLogin || undefined,
            phone_pass: phonePass || undefined,
            status: isActive ? "active" : "suspended",
          },
        });
        toast.success("Agent provisioned successfully");
      }
      onSaved();
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save agent");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-y-auto border border-white/10 bg-[#12161F] text-white shadow-2xl sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-lg font-bold">
            <UserCog className="size-5 text-[#F5B021]" />
            {isEdit ? "Edit Agent" : "Provision New Agent"}
          </DialogTitle>
          <DialogDescription className="text-white/50">
            {isEdit
              ? "Update agent profile, role, and SIP phone credentials."
              : "Create a new agent account with CRM access and telephony provisioning."}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Profile Section */}
          <section className="space-y-4">
            <h3 className="text-xs font-bold uppercase tracking-wider text-[#F5B021]/80">
              Profile & Access
            </h3>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="agent-fullname" className="text-xs font-semibold uppercase text-white/60">
                  Full Name
                </Label>
                <Input
                  id="agent-fullname"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  required
                  placeholder="e.g. Sipho Dlamini"
                  className="border-white/10 bg-[#0B0D11] text-white"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="agent-email" className="text-xs font-semibold uppercase text-white/60">
                  Email
                </Label>
                <Input
                  id="agent-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  placeholder="agent@fibregems.co.za"
                  className="border-white/10 bg-[#0B0D11] text-white"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="agent-role" className="text-xs font-semibold uppercase text-white/60">
                  Role
                </Label>
                <Select value={role} onValueChange={(v) => handleRoleChange(v as typeof role)}>
                  <SelectTrigger className="border-white/10 bg-[#0B0D11] text-white">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="border-white/10 bg-[#12161F] text-white">
                    {Object.entries(ROLE_LABELS).map(([val, label]) => (
                      <SelectItem key={val} value={val}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="agent-code" className="text-xs font-semibold uppercase text-white/60">
                  Agent Code (optional)
                </Label>
                <Input
                  id="agent-code"
                  value={agentCode}
                  onChange={(e) => setAgentCode(e.target.value)}
                  placeholder={`Auto-suggest: ${ROLE_PREFIX[role]}...`}
                  className="border-white/10 bg-[#0B0D11] text-white"
                />
                <p className="text-[10px] text-white/40">
                  Prefix: <span className="font-mono text-cyan-400">agt</span> (Agent), <span className="font-mono text-amber-400">tml</span> (Team Lead), <span className="font-mono text-orange-400">adm</span> (Admin)
                </p>
              </div>
            </div>

            {/* Password */}
            <div className="space-y-1.5">
              <Label htmlFor="agent-password" className="text-xs font-semibold uppercase text-white/60">
                {isEdit ? "New Password (leave blank to keep current)" : "Password"}
              </Label>
              <div className="relative">
                <Input
                  id="agent-password"
                  type={showPass ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={isEdit ? "••••••••" : "Minimum 6 characters"}
                  required={!isEdit}
                  className="border-white/10 bg-[#0B0D11] pr-10 text-white"
                />
                <button
                  type="button"
                  onClick={() => setShowPass((v) => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-white/40 hover:text-white"
                >
                  {showPass ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </button>
              </div>
            </div>

            {/* Active toggle */}
            <div className="flex items-center justify-between rounded-lg border border-white/5 bg-[#0B0D11] px-4 py-3">
              <div>
                <p className="text-sm font-semibold text-white">Account Active</p>
                <p className="text-xs text-white/40">Suspended agents cannot log in</p>
              </div>
              <Switch checked={isActive} onCheckedChange={setIsActive} />
            </div>
          </section>

          {/* Telephony Provisioning Section */}
          <section className="space-y-4 rounded-xl border border-[#06B6D4]/20 bg-[#06B6D4]/5 p-4">
            <div className="flex items-center gap-2">
              <Phone className="size-4 text-[#06B6D4]" />
              <h3 className="text-xs font-bold uppercase tracking-wider text-[#06B6D4]">
                SIP Phone Provisioning
              </h3>
            </div>
            <p className="text-xs text-white/40">
              These credentials link the agent to their VICIdial phone session. They are never shown
              to the agent in plain text after saving.
            </p>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="phone-login" className="text-xs font-semibold uppercase text-white/60">
                  Phone Login (SIP Extension)
                </Label>
                <div className="flex gap-2">
                  <Input
                    id="phone-login"
                    value={phoneLogin}
                    onChange={(e) => handlePhoneLoginChange(e.target.value)}
                    placeholder="e.g. 102"
                    className="border-white/10 bg-[#0B0D11] text-white"
                  />
                  {phoneLogin && (
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      onClick={() => copyToClipboard(phoneLogin, "Phone login")}
                      className="border-white/10"
                    >
                      <Copy className="size-4" />
                    </Button>
                  )}
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="phone-pass" className="text-xs font-semibold uppercase text-white/60">
                  Phone Password
                </Label>
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <Input
                      id="phone-pass"
                      type={showPhonePass ? "text" : "password"}
                      value={phonePass}
                      onChange={(e) => setPhonePass(e.target.value)}
                      placeholder="SIP secret"
                      className="border-white/10 bg-[#0B0D11] pr-10 text-white"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPhonePass((v) => !v)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-white/40 hover:text-white"
                    >
                      {showPhonePass ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                    </button>
                  </div>
                  {phonePass && (
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      onClick={() => copyToClipboard(phonePass, "Phone password")}
                      className="border-white/10"
                    >
                      <Copy className="size-4" />
                    </Button>
                  )}
                </div>
              </div>
            </div>
          </section>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              className="border-white/10 text-white"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={busy}
              className="bg-gradient-to-r from-[#E07C2A] to-[#F5B021] text-black hover:opacity-90"
            >
              {busy ? "Saving…" : isEdit ? "Save Changes" : "Provision Agent"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
