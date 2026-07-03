use anyhow::{anyhow, Result};
use std::mem::transmute;
use windows::core::{Interface, BSTR, VARIANT};
use windows::Win32::Foundation::VARIANT_BOOL;
use windows::Win32::NetworkManagement::WindowsFirewall::{
    INetFwPolicy2, INetFwRule, NetFwPolicy2, NetFwRule, NET_FW_ACTION_BLOCK, NET_FW_RULE_DIR_OUT,
};
use windows::Win32::System::Com::{
    CoCreateInstance, CoInitializeEx, CLSCTX_INPROC_SERVER, COINIT_APARTMENTTHREADED,
};
use windows::Win32::System::Ole::IEnumVARIANT;

const RULE_NAME: &str = "sombra/rules";
const RULE_GROUP: &str = "sombra/group";

/// Initialize COM library for the current thread.
pub fn initialize_com() -> Result<()> {
    unsafe {
        let hr = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
        if hr.is_ok() {
            Ok(())
        } else {
            // S_FALSE (0x00000001) means COM was already initialized, which is acceptable
            if hr.0 == 1 {
                Ok(())
            } else {
                Err(anyhow!("Failed to initialize COM: {:?}", hr))
            }
        }
    }
}

/// Helper to cast a VARIANT to INetFwRule if it holds a VT_DISPATCH pointer.
fn variant_to_rule(var: &VARIANT) -> Option<INetFwRule> {
    unsafe {
        let raw = var.as_raw();
        // VT_DISPATCH = 9
        if raw.Anonymous.Anonymous.vt == 9 {
            let pdisp = raw.Anonymous.Anonymous.Anonymous.pdispVal;
            if !pdisp.is_null() {
                // Transmute the reference to pdispVal (*mut c_void) into &IUnknown
                let unknown: &windows::core::IUnknown =
                    transmute(&raw.Anonymous.Anonymous.Anonymous.pdispVal);
                // Cast (QueryInterface) to INetFwRule, which increments the refcount of the returned rule
                if let Ok(rule) = unknown.cast::<INetFwRule>() {
                    return Some(rule);
                }
            }
        }
        None
    }
}

/// Fetches the description, blocked IPs (remote addresses), and tunneling path (application name)
/// from the firewall rule, if it exists.
pub fn get_rules_description_and_blocked(
) -> Result<(Option<String>, Option<String>, Option<String>)> {
    let _ = initialize_com();
    unsafe {
        let policy: INetFwPolicy2 = CoCreateInstance(&NetFwPolicy2, None, CLSCTX_INPROC_SERVER)?;
        let rules = policy.Rules()?;
        let enum_unknown = rules._NewEnum()?;
        let enumerator: IEnumVARIANT = enum_unknown.cast()?;

        let mut variant = VARIANT::default();
        let mut fetched = 0u32;

        let rule_name_bstr = BSTR::from(RULE_NAME);

        while enumerator
            .Next(std::slice::from_mut(&mut variant), &mut fetched as *mut u32)
            .is_ok()
            && fetched == 1
        {
            if let Some(rule) = variant_to_rule(&variant) {
                if let Ok(name) = rule.Name() {
                    if name == rule_name_bstr {
                        let desc = rule.Description().ok().map(|b| b.to_string());
                        let remote = rule.RemoteAddresses().ok().map(|b| b.to_string());
                        let app = rule.ApplicationName().ok().map(|b| b.to_string());

                        // variant will be automatically dropped (and cleared) upon return
                        return Ok((desc, remote, app));
                    }
                }
            }
            // Clear the variant by re-assigning default. This drops the old one, calling VariantClear.
            variant = VARIANT::default();
            fetched = 0;
        }
    }

    Ok((None, None, None))
}

/// Deletes all firewall rules in the Sombra group.
pub fn delete_sombra_rules() -> Result<()> {
    let _ = initialize_com();
    unsafe {
        let policy: INetFwPolicy2 = CoCreateInstance(&NetFwPolicy2, None, CLSCTX_INPROC_SERVER)?;
        let rules = policy.Rules()?;

        // Find and delete all rules matching our name or group
        let enum_unknown = rules._NewEnum()?;
        let enumerator: IEnumVARIANT = enum_unknown.cast()?;

        let mut variant = VARIANT::default();
        let mut fetched = 0u32;
        let mut rules_to_delete = Vec::new();

        let rule_name_bstr = BSTR::from(RULE_NAME);
        let rule_group_bstr = BSTR::from(RULE_GROUP);

        while enumerator
            .Next(std::slice::from_mut(&mut variant), &mut fetched as *mut u32)
            .is_ok()
            && fetched == 1
        {
            if let Some(rule) = variant_to_rule(&variant) {
                let matches_name = rule.Name().map(|n| n == rule_name_bstr).unwrap_or(false);
                let matches_group = rule
                    .Grouping()
                    .map(|g| g == rule_group_bstr)
                    .unwrap_or(false);
                if matches_name || matches_group {
                    if let Ok(name) = rule.Name() {
                        rules_to_delete.push(name);
                    }
                }
            }
            // Clear the variant for next iteration
            variant = VARIANT::default();
            fetched = 0;
        }

        for name in rules_to_delete {
            crate::logger::info(&format!("Deleting firewall rule: {}", name));
            let _ = rules.Remove(&name);
        }
    }
    Ok(())
}

/// Configures and writes the firewall rule.
/// If `blocked_ips` is empty, the rule is written but disabled.
pub fn apply_rules(
    description: &str,
    blocked_ips: &str,
    tunneling_path: Option<&str>,
) -> Result<()> {
    let _ = initialize_com();
    crate::logger::info(&format!(
        "Applying firewall rules. Path: {:?}, Blocked IPs: {}",
        tunneling_path, blocked_ips
    ));

    let res = (|| -> Result<()> {
        // 1. First, delete any duplicate or existing rules to ensure a clean state
        delete_sombra_rules()?;

        // 2. Create a new firewall rule
        unsafe {
            let policy: INetFwPolicy2 =
                CoCreateInstance(&NetFwPolicy2, None, CLSCTX_INPROC_SERVER)?;
            let rules = policy.Rules()?;

            let new_rule: INetFwRule = CoCreateInstance(&NetFwRule, None, CLSCTX_INPROC_SERVER)?;

            new_rule.SetName(&BSTR::from(RULE_NAME))?;
            new_rule.SetGrouping(&BSTR::from(RULE_GROUP))?;
            new_rule.SetDescription(&BSTR::from(description))?;

            // Protocol UDP = 17 (Allows TCP login/auth traffic while blocking UDP match servers)
            new_rule.SetProtocol(17)?;
            new_rule.SetDirection(NET_FW_RULE_DIR_OUT)?;
            new_rule.SetAction(NET_FW_ACTION_BLOCK)?;

            // All profiles mask = 0x7FFFFFFF (Domain, Private, Public)
            new_rule.SetProfiles(0x7FFFFFFF)?;

            if let Some(app_path) = tunneling_path {
                if !app_path.trim().is_empty() {
                    new_rule.SetApplicationName(&BSTR::from(app_path))?;
                }
            }

            if blocked_ips.trim().is_empty() {
                // Nothing to block -> disable rule
                new_rule.SetEnabled(VARIANT_BOOL::from(false))?;
            } else {
                // Block selected IPs -> enable rule
                new_rule.SetRemoteAddresses(&BSTR::from(blocked_ips))?;
                new_rule.SetEnabled(VARIANT_BOOL::from(true))?;
            }

            // Add the configured rule to the system
            rules.Add(&new_rule)?;
        }
        Ok(())
    })();

    match &res {
        Ok(_) => crate::logger::info("Firewall rules applied successfully via COM."),
        Err(e) => crate::logger::error(&format!("Error applying firewall rules: {:?}", e)),
    }
    res
}
