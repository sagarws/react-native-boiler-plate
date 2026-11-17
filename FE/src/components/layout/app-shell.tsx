"use client";

import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { CmsScriptProgress } from "@/components/layout/cms-script-progress";
import { MailboxDisconnectedAlert } from "@/components/layout/mailbox-disconnected-alert";
import { OtpPromptModal } from "@/components/layout/otp-prompt-modal";
import { ShellBanners } from "@/components/layout/shell-banners";
import { Sidebar } from "@/components/layout/sidebar";
import { Topbar } from "@/components/layout/topbar";
import { ErrorState, LoadingState } from "@/components/ui/states";
import { accessForPath } from "@/config/navigation";
import ROUTE_URLS from "@/config/route";
import { isVideoLinkOnlyUser } from "@/lib/access";
import { toast } from "@/lib/events";
import { canAccess } from "@/lib/permissions";
import { readStored, writeStored } from "@/lib/storage";
import { AuthService } from "@/services/auth-service";
import { EmailSummaryService } from "@/services/email-summary-service";
import { NotificationsService } from "@/services/notification-service";
import { SessionStore } from "@/services/session";
import { useDispatch, useSelector } from "@/store";
import { fetchNotifications, setLoadingNotificationSuccess } from "@/store/notification-slice";
import { getUserProfile, resetProfile, setUserProfile } from "@/store/profile-slice";

type MockRole = "admin" | "system_admin";

/** Dashboard shell: auth guard, profile bootstrap, live notifications, sidebar + topbar + hosts. */
export default function AppShell({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const dispatch = useDispatch();
  const { userProfile, userLoading, userError } = useSelector((s) => s.profile);
  const [hasToken] = useState(() => Boolean(SessionStore.getToken()));
  const [collapsed, setCollapsed] = useState<boolean>(() => window.innerWidth >= 768 && readStored<boolean>("sidebar-collapsed", false));
  const [mobileOpen, setMobileOpen] = useState(false);
  const [mockRole, setMockRole] = useState<MockRole>(() => readStored<MockRole>("mock-role", "admin"));
  const [impersonator] = useState(() => SessionStore.getImpersonator());
  const [pendingEmails, setPendingEmails] = useState(0);
  const [mailboxAlert, setMailboxAlert] = useState<{ total: number; disconnected: number } | null>(null);

  // Guard: no token → login (TrackVid RouteAuthGuard).
  useEffect(() => {
    if (!hasToken) router.replace(`${ROUTE_URLS.LOGIN}?redirect=${encodeURIComponent(pathname)}`);
  }, [hasToken, pathname, router]);

  useEffect(() => {
    if (hasToken && !userProfile && !userLoading && !userError) void dispatch(getUserProfile());
  }, [dispatch, hasToken, userProfile, userLoading, userError]);

  // Apply the sample role switch on top of the loaded profile.
  useEffect(() => {
    if (userProfile && userProfile.role.name !== mockRole) {
      dispatch(setUserProfile({ ...userProfile, role: { ...userProfile.role, name: mockRole } }));
    }
  }, [dispatch, userProfile, mockRole]);

  // Notifications + simulated SSE stream.
  useEffect(() => {
    if (!userProfile?._id) return;
    void dispatch(fetchNotifications());
    return NotificationsService.subscribeNotifications((all) => dispatch(setLoadingNotificationSuccess(all)));
  }, [dispatch, userProfile?._id]);

  // Sidebar email badge + disconnected mailbox alert (once per session).
  const canViewMailboxes = canAccess(userProfile, ["admin"], ["email::mailbox::view"]);
  const canViewEmails = canAccess(userProfile, ["admin"], ["email::view"]);
  useEffect(() => {
    if (!userProfile?._id) return;
    let active = true;
    if (canViewEmails) {
      EmailSummaryService.getPendingEmailCount()
        .then((r) => active && setPendingEmails(r.count))
        .catch(() => {
          // Sidebar count is decorative: TrackVid also fails silently here.
        });
    }
    if (canViewMailboxes && !readStored("mailbox-alert-seen", false)) {
      EmailSummaryService.getMailboxConnectionSummary()
        .then((r) => {
          if (active && r.disconnected > 0) setMailboxAlert(r);
        })
        .catch(() => {
          // The alert is advisory; skip it if the summary cannot load.
        });
    }
    return () => {
      active = false;
    };
  }, [userProfile?._id, canViewEmails, canViewMailboxes]);

  // Route permission guard (TrackVid AccessRestriction → back to Dashboard).
  const access = accessForPath(pathname);
  const allowed = !userProfile || !access || access.roles.length + access.permissions.length === 0 || canAccess(userProfile, access.roles, access.permissions);
  const videoOnlyOnDashboard = Boolean(userProfile && pathname === ROUTE_URLS.DASHBOARD && isVideoLinkOnlyUser(userProfile));
  useEffect(() => {
    if (!userProfile) return;
    if (videoOnlyOnDashboard) router.replace(ROUTE_URLS.VIDEO_LINK);
    else if (!allowed) router.replace(ROUTE_URLS.DASHBOARD);
  }, [allowed, videoOnlyOnDashboard, router, userProfile]);

  // Close the mobile drawer when the route changes (adjusted during render, not in an effect).
  const [navPath, setNavPath] = useState(pathname);
  if (navPath !== pathname) {
    setNavPath(pathname);
    setMobileOpen(false);
  }

  const logout = useCallback(async () => {
    try {
      await AuthService.logout();
    } catch {
      // Logout must always finish locally even if the call fails.
    }
    SessionStore.clear();
    dispatch(resetProfile());
    toast.success("Logged out");
    router.replace(ROUTE_URLS.LOGIN);
  }, [dispatch, router]);

  if (!hasToken) return <LoadingState label="Redirecting to sign in…" />;
  if (userError && !userProfile) {
    return (
      <div className="tv-fullscreen-state">
        <ErrorState title="Could not load your account" message={userError} onRetry={() => void dispatch(getUserProfile())} />
      </div>
    );
  }
  if (!userProfile) {
    return (
      <div className="tv-fullscreen-state">
        <LoadingState label="Loading your workspace…" />
      </div>
    );
  }

  return (
    <div className={`app-shell${collapsed ? " collapsed" : ""}${mobileOpen ? " mobile-nav-open" : ""}`}>
      <Sidebar
        pathname={pathname}
        user={userProfile}
        badges={{ pendingEmails }}
        collapsed={collapsed}
        onToggleCollapsed={() => {
          writeStored("sidebar-collapsed", !collapsed);
          setCollapsed(!collapsed);
        }}
        onCloseMobile={() => setMobileOpen(false)}
      />
      <div className="workspace">
        <Topbar
          title={access?.title ?? "TrackVid"}
          user={userProfile}
          mobileNavOpen={mobileOpen}
          onOpenMobileNav={() => setMobileOpen((o) => !o)}
          onLogout={() => void logout()}
          mockRole={mockRole}
          onMockRoleChange={(r) => {
            setMockRole(r);
            writeStored("mock-role", r);
            toast.info(r === "admin" ? "Viewing as Admin" : "Viewing as System admin");
          }}
          impersonator={impersonator}
        />
        <main id="main-content" tabIndex={-1}>
          <ShellBanners user={userProfile} />
          {allowed && !videoOnlyOnDashboard ? children : <LoadingState label="Redirecting…" />}
        </main>
        <CmsScriptProgress />
        <OtpPromptModal />
        {mailboxAlert ? (
          <MailboxDisconnectedAlert
            disconnectedCount={mailboxAlert.disconnected}
            totalCount={mailboxAlert.total}
            onClose={() => {
              writeStored("mailbox-alert-seen", true);
              setMailboxAlert(null);
            }}
          />
        ) : null}
      </div>
    </div>
  );
}
