import { NavLink, Outlet } from 'react-router-dom';

export default function AdminLayout() {
  return (
    <div>
      <div className="page-head">
        <h1>Admin</h1>
      </div>
      <div className="segmented wrap">
        <NavLink to="/admin/checklist">Checklist preset</NavLink>
        <NavLink to="/admin/scaffolds">Scaffolds</NavLink>
        <NavLink to="/admin/users">Users</NavLink>
        <NavLink to="/admin/settings">Settings</NavLink>
        <NavLink to="/admin/archive">Archive & wipe</NavLink>
      </div>
      <Outlet />
    </div>
  );
}
