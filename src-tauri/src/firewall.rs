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

pub fn initialize_com() -> Result<()> {
    unsafe {
        let hr = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
        if hr.is_ok() {
            Ok(())
        } else {
            if hr.0 == 1 || hr.0 == 0x80010106_u32 as i32 {
                Ok(())
            } else {
                Err(anyhow!("Failed to initialize COM: {:?}", hr))
            }
        }
    }
}

fn variant_to_rule(var: &VARIANT) -> Option<INetFwRule> {
    unsafe {
        let raw = var.as_raw();
        if raw.Anonymous.Anonymous.vt == 9 {
            let pdisp = raw.Anonymous.Anonymous.Anonymous.pdispVal;
            if !pdisp.is_null() {
                let unknown: &windows::core::IUnknown =
                    transmute(&raw.Anonymous.Anonymous.Anonymous.pdispVal);
                if let Ok(rule) = unknown.cast::<INetFwRule>() {
                    return Some(rule);
                }
            }
        }
        None
    }
}

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

                        return Ok((desc, remote, app));
                    }
                }
            }
            variant = VARIANT::default();
            fetched = 0;
        }
    }

    Ok((None, None, None))
}

pub fn delete_sombra_rules() -> Result<()> {
    let _ = initialize_com();
    unsafe {
        let policy: INetFwPolicy2 = CoCreateInstance(&NetFwPolicy2, None, CLSCTX_INPROC_SERVER)?;
        let rules = policy.Rules()?;

        let enum_unknown = rules._NewEnum()?;
        let enumerator: IEnumVARIANT = enum_unknown.cast()?;

        let mut variant = VARIANT::default();
        let mut fetched = 0u32;
        let mut rules_to_delete = Vec::new();

        while enumerator
            .Next(std::slice::from_mut(&mut variant), &mut fetched as *mut u32)
            .is_ok()
            && fetched == 1
        {
            if let Some(rule) = variant_to_rule(&variant) {
                if let Ok(name) = rule.Name() {
                    let name_str = name.to_string();
                    if name_str == "sombra/rules" || name_str == "sombra/rules-tcp" {
                        rules_to_delete.push(name);
                    }
                }
            }
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
        delete_sombra_rules()?;

        unsafe {
            let policy: INetFwPolicy2 =
                CoCreateInstance(&NetFwPolicy2, None, CLSCTX_INPROC_SERVER)?;
            let rules = policy.Rules()?;

            let new_rule: INetFwRule = CoCreateInstance(&NetFwRule, None, CLSCTX_INPROC_SERVER)?;

            new_rule.SetName(&BSTR::from(RULE_NAME))?;
            new_rule.SetGrouping(&BSTR::from(RULE_GROUP))?;
            new_rule.SetDescription(&BSTR::from(description))?;

            new_rule.SetProtocol(17)?;
            new_rule.SetDirection(NET_FW_RULE_DIR_OUT)?;
            new_rule.SetAction(NET_FW_ACTION_BLOCK)?;

            new_rule.SetProfiles(0x7FFFFFFF)?;

            if let Some(app_path) = tunneling_path {
                if !app_path.trim().is_empty() {
                    new_rule.SetApplicationName(&BSTR::from(app_path))?;
                }
            }

            if blocked_ips.trim().is_empty() {
                new_rule.SetEnabled(VARIANT_BOOL::from(false))?;
            } else {
                new_rule.SetRemoteAddresses(&BSTR::from(blocked_ips))?;
                new_rule.SetEnabled(VARIANT_BOOL::from(true))?;
            }

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
