import { createFileRoute, redirect } from "@tanstack/react-router";
import { getCurrentUserFn } from "@/server/functions";
import { TeamLeadWorkspace } from "@/components/team-lead/TeamLeadWorkspace";

export const Route = createFileRoute("/_authenticated/team-lead")({
  beforeLoad: async () => {
    const res = await getCurrentUserFn();
    const user = res?.user;
    const isAllowed =
      user?.role === "team_leader" ||
      user?.role === "admin" ||
      user?.email?.startsWith("admin") ||
      user?.email === "fibregems@gmail.com";
    if (!isAllowed) throw redirect({ to: "/agent" });
  },
  head: () => ({
    meta: [
      { title: "Team Lead Floor — FibreGems CRM" },
      { name: "description", content: "Watch the live floor, step in on calls, and reassign callbacks." },
    ],
  }),
  component: TeamLeadWorkspace,
});
