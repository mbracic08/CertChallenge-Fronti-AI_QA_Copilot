import {
  LayoutDashboard,
  Play,
  FileBarChart,
  FlaskConical,
  Info,
  type LucideIcon,
} from "lucide-react";

export interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
}

export const MAIN_NAV: NavItem[] = [
  { label: "Workspace", href: "/workspace", icon: LayoutDashboard },
  { label: "Runs", href: "/runs", icon: Play },
  { label: "Reports", href: "/reports", icon: FileBarChart },
  { label: "Evaluation", href: "/evaluation", icon: FlaskConical },
  { label: "About", href: "/about", icon: Info },
] as const;
