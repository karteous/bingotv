import { redirect } from "next/navigation";

// /admin 本身没有内容，统一重定向到设置页
export default function AdminPage() {
  redirect("/admin/settings");
}
