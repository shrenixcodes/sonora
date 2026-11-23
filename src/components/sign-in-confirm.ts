/**
 * Sign-in confirmation.
 *
 * Shown once a sign-in started from Sonora finishes, so the user can check
 * which Google account YouTube Music is now using, and switch if it's wrong.
 */

import { el } from "@/lib/dom";
import { account, type AccountProfile } from "@/lib/ytm/account";
import { ytmBridge } from "@/lib/playback/ytm-bridge";

export function showSignInConfirmation(): void {
  document.querySelector(".signin-confirm")?.remove();

  const avatar = el("img", { className: "signin-confirm__avatar", attrs: { alt: "" } });
  const name = el("p", { className: "signin-confirm__name" });
  const detail = el("p", { className: "signin-confirm__detail" });
  const status = el("p", { className: "signin-confirm__status", attrs: { role: "status" } });

  const fill = (profile: AccountProfile | null) => {
    avatar.toggleAttribute("hidden", !profile?.photoUrl);
    if (profile?.photoUrl) avatar.setAttribute("src", profile.photoUrl);
    name.textContent = profile?.name ?? "Your Google account";
    detail.textContent = profile ? (profile.email ?? profile.handle ?? "") : "Loading account details…";
  };
  fill(account.profile);
  const stopProfile = account.on("profile", fill);

  const continueBtn = el("button", {
    className: "btn btn--primary",
    text: "Continue",
    attrs: { type: "button" },
    onClick: () => dialog.close(),
  });

  const switchBtn = el("button", {
    className: "btn btn--secondary",
    text: "Use another account",
    attrs: { type: "button" },
    onClick: async () => {
      switchBtn.setAttribute("disabled", "");
      continueBtn.setAttribute("disabled", "");
      status.textContent = "Signing out…";
      try {
        await ytmBridge.signOut();
        account.update(false);
        account.beginSignIn();
        await ytmBridge.setSignInVisible(true);
        dialog.close();
      } catch (err) {
        console.error("[sign-in] could not switch accounts:", err);
        status.textContent = "That didn't work. Try again from Settings.";
        switchBtn.removeAttribute("disabled");
        continueBtn.removeAttribute("disabled");
      }
    },
  });

  const dialog = el("dialog", {
    className: "signin-confirm",
    attrs: { "aria-labelledby": "signin-confirm-title" },
    children: [
      avatar,
      el("h2", { className: "signin-confirm__title", text: "You're signed in", attrs: { id: "signin-confirm-title" } }),
      name,
      detail,
      el("p", {
        className: "signin-confirm__hint",
        text: "Home, your likes, playlists and Premium now come from this account.",
      }),
      status,
      el("div", { className: "signin-confirm__actions", children: [switchBtn, continueBtn] }),
    ],
  }) as HTMLDialogElement;

  dialog.addEventListener("close", () => {
    stopProfile();
    dialog.remove();
  });
  document.body.appendChild(dialog);
  dialog.showModal();
  continueBtn.focus();
}
