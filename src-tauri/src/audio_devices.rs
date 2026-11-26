//! Windows per-app audio output enumeration and stream routing.
//!
//! Uses public Core Audio COM APIs (`IMMDeviceEnumerator`, `IPropertyStore`) to
//! inspect active playback endpoints, detect hardware form factors and transport
//! kinds (wired / wireless / Bluetooth), and routes only Sonora's process tree
//! (`sonora.exe` and its WebView2 child processes) via `AudioPolicyConfig`
//! without altering Windows' system-wide default playback device.

use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet, VecDeque};
use std::sync::Mutex;
use std::time::{Duration, Instant};

const TREE_RESCAN_INTERVAL: Duration = Duration::from_secs(20);

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum AudioDeviceType {
    Speaker,
    Headphones,
    Headset,
    Earbuds,
    Monitor,
    Dac,
    Handset,
    Generic,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum AudioTransport {
    Wired,
    Wireless,
    Bluetooth,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AudioOutputDevice {
    pub id: String,
    pub name: String,
    pub description: String,
    pub device_type: AudioDeviceType,
    pub transport: AudioTransport,
    pub is_default: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AudioOutputSnapshot {
    pub devices: Vec<AudioOutputDevice>,
    pub selected_device_id: Option<String>,
    pub effective_device_id: Option<String>,
    pub can_route_per_app: bool,
}

#[derive(Default)]
pub struct AudioOutputState {
    selected_device_id: Mutex<Option<String>>,
    applied_pids: Mutex<HashMap<u32, Option<String>>>,
    last_tree_scan: Mutex<Option<Instant>>,
}

impl AudioOutputState {
    pub fn ensure_process_tree_routed(&self) {
        let Ok(selected_guard) = self.selected_device_id.lock() else {
            return;
        };
        let Some(ref target_id) = *selected_guard else {
            return;
        };
        let target_clone = target_id.clone();
        drop(selected_guard);

        let now = Instant::now();
        if let Ok(mut last_scan) = self.last_tree_scan.lock() {
            if let Some(prev) = *last_scan
                && now.duration_since(prev) < TREE_RESCAN_INTERVAL
            {
                return;
            }
            *last_scan = Some(now);
        }

        let pids = sonora_process_tree_pids();
        let Ok(mut applied) = self.applied_pids.lock() else {
            return;
        };
        let live_pids: HashSet<u32> = pids.iter().copied().collect();
        applied.retain(|pid, _| live_pids.contains(pid));
        let pending: Vec<u32> = pids
            .into_iter()
            .filter(|pid| applied.get(pid).is_none_or(|prev| prev.as_deref() != Some(&target_clone)))
            .collect();
        if pending.is_empty() {
            return;
        }
        if apply_endpoint_to_pids(&pending, Some(&target_clone)).is_ok() {
            for pid in pending {
                applied.insert(pid, Some(target_clone.clone()));
            }
        }
    }
}

/// Classifies transport and device type from Windows Core Audio endpoint metadata.
pub fn classify_audio_device(
    friendly_name: &str,
    device_desc: &str,
    interface_name: &str,
    enumerator_name: &str,
    form_factor: Option<u32>,
) -> (AudioDeviceType, AudioTransport) {
    let enum_upper = enumerator_name.trim().to_ascii_uppercase();
    let combined = format!("{friendly_name} {device_desc} {interface_name}").to_ascii_lowercase();

    let is_bluetooth = enum_upper.starts_with("BTH")
        || combined.contains("bluetooth")
        || combined.contains("hands-free")
        || combined.contains("a2dp")
        || combined.contains("ble audio")
        || combined.contains("bt audio");

    let is_wireless = !is_bluetooth
        && (form_factor == Some(0) // RemoteNetworkDevice
            || combined.contains("wireless")
            || combined.contains("2.4g")
            || combined.contains("2.4 ghz")
            || combined.contains("lightspeed")
            || combined.contains("slipstream")
            || combined.contains("airplay")
            || combined.contains("chromecast")
            || combined.contains("wi-fi")
            || combined.contains("sonos")
            || combined.contains("dongle"));

    let transport = if is_bluetooth {
        AudioTransport::Bluetooth
    } else if is_wireless {
        AudioTransport::Wireless
    } else {
        AudioTransport::Wired
    };

    let device_type = infer_device_type(&combined, form_factor);
    (device_type, transport)
}

fn infer_device_type(text: &str, form_factor: Option<u32>) -> AudioDeviceType {
    if text.contains("earbud")
        || text.contains("airpods")
        || text.contains("galaxy buds")
        || text.contains("buds")
        || text.contains("in-ear")
        || text.contains("earpods")
        || text.contains("wf-1000")
        || text.contains("tws")
    {
        return AudioDeviceType::Earbuds;
    }

    match form_factor {
        Some(0) => AudioDeviceType::Speaker, // RemoteNetworkDevice
        Some(2) | Some(7) | Some(8) => AudioDeviceType::Dac, // LineLevel, UnknownDigitalPassthrough, SPDIF
        Some(3) => AudioDeviceType::Headphones,
        Some(5) => AudioDeviceType::Headset,
        Some(6) => AudioDeviceType::Handset,
        Some(9) => AudioDeviceType::Monitor, // DigitalAudioDisplayDevice (HDMI / DisplayPort)
        Some(1) => {
            // Windows sometimes marks USB headphones/HDMI monitors as Speakers unless overridden.
            if text.contains("headset") {
                AudioDeviceType::Headset
            } else if text.contains("headphone") || text.contains("earphone") {
                AudioDeviceType::Headphones
            } else if text.contains("hdmi") || text.contains("displayport") || text.contains("monitor") {
                AudioDeviceType::Monitor
            } else if text.contains("dac") || text.contains("s/pdif") || text.contains("spdif") || text.contains("optical") {
                AudioDeviceType::Dac
            } else {
                AudioDeviceType::Speaker
            }
        }
        _ => {
            if text.contains("headset") {
                AudioDeviceType::Headset
            } else if text.contains("headphone") || text.contains("earphone") {
                AudioDeviceType::Headphones
            } else if text.contains("hdmi")
                || text.contains("displayport")
                || text.contains("monitor")
                || text.contains("television")
                || text.contains("tv")
            {
                AudioDeviceType::Monitor
            } else if text.contains("dac")
                || text.contains("s/pdif")
                || text.contains("spdif")
                || text.contains("line out")
                || text.contains("optical")
            {
                AudioDeviceType::Dac
            } else if text.contains("handset") {
                AudioDeviceType::Handset
            } else if text.contains("speaker") || text.contains("soundbar") || text.contains("realtek") {
                AudioDeviceType::Speaker
            } else {
                AudioDeviceType::Generic
            }
        }
    }
}

#[cfg(windows)]
mod win_impl {
    use super::*;
    use std::ffi::c_void;
    use std::mem::size_of;
    use windows::Win32::Devices::FunctionDiscovery::PKEY_Device_FriendlyName;
    use windows::Win32::Foundation::{CloseHandle, HANDLE, PROPERTYKEY, RPC_E_CHANGED_MODE};
    use windows::Win32::Media::Audio::{
        DEVICE_STATE_ACTIVE, IMMDeviceEnumerator, MMDeviceEnumerator, PKEY_AudioEndpoint_FormFactor,
        eMultimedia, eRender,
    };
    use windows::Win32::System::Com::{
        CLSCTX_ALL, COINIT_APARTMENTTHREADED, CoCreateInstance, CoInitializeEx, CoTaskMemFree,
        CoUninitialize, STGM_READ,
    };
    use windows::Win32::System::Diagnostics::ToolHelp::{
        CreateToolhelp32Snapshot, PROCESSENTRY32W, Process32FirstW, Process32NextW,
        TH32CS_SNAPPROCESS,
    };
    use windows::Win32::System::WinRT::RoGetActivationFactory;
    use windows::Win32::UI::Shell::PropertiesSystem::IPropertyStore;
    use windows::core::{GUID, HRESULT, HSTRING, IUnknown, Interface, PWSTR};

    const PKEY_DEVICE_DESC: PROPERTYKEY = PROPERTYKEY {
        fmtid: GUID::from_u128(0xa45c254e_df1c_4efd_8020_67d146a850e0),
        pid: 2,
    };
    const PKEY_DEVICE_ENUMERATOR_NAME: PROPERTYKEY = PROPERTYKEY {
        fmtid: GUID::from_u128(0xa45c254e_df1c_4efd_8020_67d146a850e0),
        pid: 24,
    };
    const PKEY_DEVICE_INTERFACE_FRIENDLY_NAME: PROPERTYKEY = PROPERTYKEY {
        fmtid: GUID::from_u128(0x026e516e_b814_414b_83cd_856d6fef4822),
        pid: 2,
    };

    /// Win10 21H2+ / Win11 & Win10 RS4+ internal WinRT audio policy interface UUIDs.
    const IID_AUDIO_POLICY_21H2: GUID = GUID::from_u128(0xab3d4648_e242_459f_b02f_541c70306324);
    const IID_AUDIO_POLICY_RS4: GUID = GUID::from_u128(0x2a59116d_6c4f_45e0_a74f_707e3fef9258);
    const SET_PERSISTED_ENDPOINT_SLOT: usize = 25;

    struct ComGuard(bool);

    impl ComGuard {
        fn init() -> Result<Self, String> {
            let hr = unsafe { CoInitializeEx(None, COINIT_APARTMENTTHREADED) };
            if hr == RPC_E_CHANGED_MODE {
                Ok(Self(false))
            } else if hr.is_ok() {
                Ok(Self(true))
            } else {
                Err(format!("COM initialization failed: {hr:?}"))
            }
        }
    }

    impl Drop for ComGuard {
        fn drop(&mut self) {
            if self.0 {
                unsafe { CoUninitialize() };
            }
        }
    }

    struct HandleGuard(HANDLE);

    impl Drop for HandleGuard {
        fn drop(&mut self) {
            unsafe {
                let _ = CloseHandle(self.0);
            }
        }
    }

    fn read_device_id(raw: PWSTR) -> Option<String> {
        if raw.is_null() {
            return None;
        }
        let value = unsafe { raw.to_string().ok() };
        unsafe { CoTaskMemFree(Some(raw.0 as *const c_void)) };
        value
    }

    fn read_prop_string(store: &IPropertyStore, key: &PROPERTYKEY) -> String {
        unsafe {
            store
                .GetValue(key)
                .ok()
                .map(|pv| pv.to_string())
                .unwrap_or_default()
        }
    }

    fn read_prop_u32(store: &IPropertyStore, key: &PROPERTYKEY) -> Option<u32> {
        unsafe {
            let pv = store.GetValue(key).ok()?;
            u32::try_from(&pv).ok().or_else(|| pv.to_string().trim().parse::<u32>().ok())
        }
    }

    pub fn list_render_devices() -> Result<Vec<AudioOutputDevice>, String> {
        let _com = ComGuard::init()?;
        let enumerator: IMMDeviceEnumerator =
            unsafe { CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL) }
                .map_err(|e| format!("Failed creating MMDeviceEnumerator: {e}"))?;

        let default_id = unsafe { enumerator.GetDefaultAudioEndpoint(eRender, eMultimedia) }
            .ok()
            .and_then(|dev| unsafe { dev.GetId().ok() })
            .and_then(read_device_id);

        let collection = unsafe { enumerator.EnumAudioEndpoints(eRender, DEVICE_STATE_ACTIVE) }
            .map_err(|e| format!("Failed enumerating playback devices: {e}"))?;
        let count = unsafe { collection.GetCount() }
            .map_err(|e| format!("Failed counting playback devices: {e}"))?;

        let mut devices = Vec::with_capacity(count as usize);
        for index in 0..count {
            let Ok(device) = (unsafe { collection.Item(index) }) else {
                continue;
            };
            let Some(id) = (unsafe { device.GetId().ok() }).and_then(read_device_id) else {
                continue;
            };

            let (friendly_name, device_desc, interface_name, enumerator_name, form_factor) =
                match unsafe { device.OpenPropertyStore(STGM_READ) } {
                    Ok(store) => (
                        read_prop_string(&store, &PKEY_Device_FriendlyName),
                        read_prop_string(&store, &PKEY_DEVICE_DESC),
                        read_prop_string(&store, &PKEY_DEVICE_INTERFACE_FRIENDLY_NAME),
                        read_prop_string(&store, &PKEY_DEVICE_ENUMERATOR_NAME),
                        read_prop_u32(&store, &PKEY_AudioEndpoint_FormFactor),
                    ),
                    Err(_) => (String::new(), String::new(), String::new(), String::new(), None),
                };

            let name = if !friendly_name.trim().is_empty() {
                friendly_name.trim().to_string()
            } else if !device_desc.trim().is_empty() {
                device_desc.trim().to_string()
            } else {
                "Audio Output".to_string()
            };

            let (device_type, transport) = classify_audio_device(
                &name,
                &device_desc,
                &interface_name,
                &enumerator_name,
                form_factor,
            );
            let is_default = default_id.as_deref() == Some(id.as_str());
            let description = if !device_desc.trim().is_empty() {
                device_desc.trim().to_string()
            } else if !interface_name.trim().is_empty() {
                interface_name.trim().to_string()
            } else {
                name.clone()
            };

            devices.push(AudioOutputDevice {
                id,
                name,
                description,
                device_type,
                transport,
                is_default,
            });
        }

        devices.sort_by(|a, b| {
            b.is_default
                .cmp(&a.is_default)
                .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
        });
        Ok(devices)
    }

    pub fn process_tree_pids() -> Vec<u32> {
        let root_pid = std::process::id();
        let Ok(snapshot) = (unsafe { CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) }) else {
            return vec![root_pid];
        };
        let _guard = HandleGuard(snapshot);

        let mut children_map: HashMap<u32, Vec<u32>> = HashMap::new();
        let mut entry = PROCESSENTRY32W {
            dwSize: size_of::<PROCESSENTRY32W>() as u32,
            ..Default::default()
        };

        if unsafe { Process32FirstW(snapshot, &mut entry) }.is_ok() {
            loop {
                children_map
                    .entry(entry.th32ParentProcessID)
                    .or_default()
                    .push(entry.th32ProcessID);
                if unsafe { Process32NextW(snapshot, &mut entry) }.is_err() {
                    break;
                }
            }
        }

        let mut result = Vec::new();
        let mut seen = HashSet::new();
        let mut queue = VecDeque::from([root_pid]);
        while let Some(pid) = queue.pop_front() {
            if !seen.insert(pid) {
                continue;
            }
            result.push(pid);
            if let Some(children) = children_map.get(&pid) {
                for &child in children {
                    if !seen.contains(&child) {
                        queue.push_back(child);
                    }
                }
            }
        }
        result
    }

    pub fn can_route_per_app() -> bool {
        let Ok(_com) = ComGuard::init() else {
            return false;
        };
        acquire_audio_policy_factory().is_some()
    }

    /// Holds an AddRef'd `IAudioPolicyConfigFactory` pointer implementing slot 25.
    struct PolicyFactoryPtr(*mut c_void);

    impl Drop for PolicyFactoryPtr {
        fn drop(&mut self) {
            if !self.0.is_null() {
                // Reconstruct `IUnknown` once to decrement the COM reference count cleanly.
                let _ = unsafe { IUnknown::from_raw(self.0) };
            }
        }
    }

    fn acquire_audio_policy_factory() -> Option<PolicyFactoryPtr> {
        let class_id = HSTRING::from("Windows.Media.Internal.AudioPolicyConfig");
        let factory: IUnknown = unsafe { RoGetActivationFactory(&class_id) }.ok()?;
        let vtbl = unsafe { &*(factory.vtable() as *const windows::core::IUnknown_Vtbl) };

        for iid in [&IID_AUDIO_POLICY_21H2, &IID_AUDIO_POLICY_RS4] {
            let mut ptr: *mut c_void = std::ptr::null_mut();
            let hr = unsafe { (vtbl.QueryInterface)(factory.as_raw(), iid, &mut ptr) };
            if hr.is_ok() && !ptr.is_null() {
                return Some(PolicyFactoryPtr(ptr));
            }
        }
        None
    }

    const DEVINTERFACE_AUDIO_RENDER_GUID: &str = "{e6327cad-dcec-4949-ae8a-991e976a79d2}";

    pub fn to_winrt_render_device_id(mmdevice_id: &str) -> String {
        let trimmed = mmdevice_id.trim();
        if trimmed.starts_with(r"\\?\SWD#MMDEVAPI#") {
            trimmed.to_string()
        } else {
            format!(r"\\?\SWD#MMDEVAPI#{trimmed}#{DEVINTERFACE_AUDIO_RENDER_GUID}")
        }
    }

    pub fn apply_endpoint(pids: &[u32], device_id: Option<&str>) -> Result<(), String> {
        let _com = ComGuard::init()?;
        let policy = acquire_audio_policy_factory()
            .ok_or_else(|| "Per-app audio device routing is unavailable on this Windows version.".to_string())?;

        type SetPersistedEndpointFn =
            unsafe extern "system" fn(*mut c_void, u32, u32, u32, *mut c_void) -> HRESULT;

        let vtable_ptr = unsafe { *(policy.0 as *const *const *const c_void) };
        let set_endpoint: SetPersistedEndpointFn =
            unsafe { std::mem::transmute(*vtable_ptr.add(SET_PERSISTED_ENDPOINT_SLOT)) };

        // In WinRT ABI, HSTRING is a single pointer handle (null clears the persisted app route).
        let device_hstring = device_id
            .map(to_winrt_render_device_id)
            .map(HSTRING::from)
            .unwrap_or_default();
        let raw_hstring: *mut c_void = unsafe { std::mem::transmute_copy(&device_hstring) };

        let mut last_err: Option<HRESULT> = None;
        let mut applied_any = false;
        for &pid in pids {
            // Apply for both eConsole (0) and eMultimedia (1) render roles on eRender (0).
            for role in [0u32, 1u32] {
                let hr = unsafe { set_endpoint(policy.0, pid, 0, role, raw_hstring) };
                if hr.is_ok() {
                    applied_any = true;
                } else {
                    last_err = Some(hr);
                }
            }
        }

        if applied_any {
            Ok(())
        } else {
            Err(format!(
                "Windows refused changing Sonora's audio stream ({:?}).",
                last_err
            ))
        }
    }
}

fn list_render_devices() -> Result<Vec<AudioOutputDevice>, String> {
    #[cfg(windows)]
    {
        win_impl::list_render_devices()
    }
    #[cfg(not(windows))]
    {
        Ok(vec![AudioOutputDevice {
            id: "default".to_string(),
            name: "System Default Output".to_string(),
            description: "Desktop default audio device".to_string(),
            device_type: AudioDeviceType::Speaker,
            transport: AudioTransport::Wired,
            is_default: true,
        }])
    }
}

fn sonora_process_tree_pids() -> Vec<u32> {
    #[cfg(windows)]
    {
        win_impl::process_tree_pids()
    }
    #[cfg(not(windows))]
    {
        vec![std::process::id()]
    }
}

fn can_route_per_app() -> bool {
    #[cfg(windows)]
    {
        win_impl::can_route_per_app()
    }
    #[cfg(not(windows))]
    {
        false
    }
}

fn apply_endpoint_to_pids(pids: &[u32], device_id: Option<&str>) -> Result<(), String> {
    #[cfg(windows)]
    {
        win_impl::apply_endpoint(pids, device_id)
    }
    #[cfg(not(windows))]
    {
        let _ = (pids, device_id);
        Err("Per-app audio output steering is supported on Windows builds only.".to_string())
    }
}

fn build_snapshot(devices: Vec<AudioOutputDevice>, selected: Option<String>) -> AudioOutputSnapshot {
    let selected_valid = selected.filter(|id| devices.iter().any(|d| d.id == *id));
    let default_id = devices.iter().find(|d| d.is_default).map(|d| d.id.clone());
    let effective_device_id = selected_valid.clone().or(default_id);
    AudioOutputSnapshot {
        devices,
        selected_device_id: selected_valid,
        effective_device_id,
        can_route_per_app: can_route_per_app(),
    }
}

#[tauri::command]
pub fn get_audio_output_devices(
    state: tauri::State<'_, AudioOutputState>,
) -> Result<AudioOutputSnapshot, String> {
    let devices = list_render_devices()?;
    let mut selected_guard = state
        .selected_device_id
        .lock()
        .map_err(|_| "Audio output state lock poisoned".to_string())?;
    let snapshot = build_snapshot(devices, selected_guard.clone());
    *selected_guard = snapshot.selected_device_id.clone();
    Ok(snapshot)
}

#[tauri::command]
pub fn set_audio_output_device(
    device_id: Option<String>,
    state: tauri::State<'_, AudioOutputState>,
) -> Result<AudioOutputSnapshot, String> {
    let normalized = device_id.and_then(|id| {
        let trimmed = id.trim();
        if trimmed.is_empty() || trimmed == "default" {
            None
        } else {
            Some(trimmed.to_string())
        }
    });

    let devices = list_render_devices()?;
    if let Some(ref target) = normalized
        && !devices.iter().any(|d| d.id == *target)
    {
        return Err("Selected audio output device is no longer connected.".to_string());
    }

    let pids = sonora_process_tree_pids();
    apply_endpoint_to_pids(&pids, normalized.as_deref())?;

    if let Ok(mut selected) = state.selected_device_id.lock() {
        *selected = normalized.clone();
    }
    if let Ok(mut applied) = state.applied_pids.lock() {
        applied.clear();
        for pid in pids {
            applied.insert(pid, normalized.clone());
        }
    }
    if let Ok(mut last_scan) = state.last_tree_scan.lock() {
        *last_scan = Some(Instant::now());
    }

    Ok(build_snapshot(devices, normalized))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn classifies_wired_wireless_and_bluetooth_device_combinations() {
        assert_eq!(
            classify_audio_device(
                "WH-1000XM5 Stereo",
                "Headphones",
                "Bluetooth Audio",
                "BTHENUM",
                Some(3),
            ),
            (AudioDeviceType::Headphones, AudioTransport::Bluetooth)
        );
        assert_eq!(
            classify_audio_device(
                "Galaxy Buds2 Pro Stereo",
                "Headset Earphone",
                "Bluetooth",
                "BTHENUM",
                Some(3),
            ),
            (AudioDeviceType::Earbuds, AudioTransport::Bluetooth)
        );
        assert_eq!(
            classify_audio_device(
                "JBL Flip 6 Stereo",
                "Speakers",
                "Bluetooth Audio",
                "BTHHFENUM",
                Some(1),
            ),
            (AudioDeviceType::Speaker, AudioTransport::Bluetooth)
        );
        assert_eq!(
            classify_audio_device(
                "HyperX Cloud Alpha Wireless",
                "USB Audio Device",
                "HyperX Wireless Dongle",
                "USB",
                Some(5),
            ),
            (AudioDeviceType::Headset, AudioTransport::Wireless)
        );
        assert_eq!(
            classify_audio_device(
                "Headphones (Realtek(R) Audio)",
                "Realtek High Definition Audio",
                "Realtek",
                "HDAUDIO",
                Some(3),
            ),
            (AudioDeviceType::Headphones, AudioTransport::Wired)
        );
        assert_eq!(
            classify_audio_device(
                "Speakers (Realtek(R) Audio)",
                "Speakers",
                "Realtek",
                "HDAUDIO",
                Some(1),
            ),
            (AudioDeviceType::Speaker, AudioTransport::Wired)
        );
        assert_eq!(
            classify_audio_device(
                "DELL U2723QE (NVIDIA High Definition Audio)",
                "NVIDIA High Definition Audio",
                "HDMI",
                "HDAUDIO",
                Some(9),
            ),
            (AudioDeviceType::Monitor, AudioTransport::Wired)
        );
        assert_eq!(
            classify_audio_device(
                "S/PDIF Interface (FiiO USB DAC)",
                "FiiO K3",
                "USB Audio",
                "USB",
                Some(8),
            ),
            (AudioDeviceType::Dac, AudioTransport::Wired)
        );
    }

    #[test]
    fn falls_back_to_system_default_when_saved_device_is_disconnected() {
        let devices = vec![AudioOutputDevice {
            id: "dev-speakers".into(),
            name: "Speakers".into(),
            description: "Realtek".into(),
            device_type: AudioDeviceType::Speaker,
            transport: AudioTransport::Wired,
            is_default: true,
        }];

        let snap = build_snapshot(devices, Some("dev-disconnected-bt".into()));
        assert_eq!(snap.selected_device_id, None);
        assert_eq!(snap.effective_device_id.as_deref(), Some("dev-speakers"));
    }

    #[cfg(windows)]
    #[test]
    fn windows_audio_enumeration_and_process_tree_work_without_crashing() {
        let pids = sonora_process_tree_pids();
        assert!(pids.contains(&std::process::id()));
        let devices = list_render_devices().expect("enumerate Windows playback endpoints");
        let can_route = can_route_per_app();
        if can_route && let Some(first) = devices.first() {
            let swd = win_impl::to_winrt_render_device_id(&first.id);
            assert!(swd.starts_with(r"\\?\SWD#MMDEVAPI#"));
            apply_endpoint_to_pids(&[std::process::id()], Some(&first.id))
                .expect("SetPersistedDefaultAudioEndpoint should accept WinRT SWD render device ID");
            apply_endpoint_to_pids(&[std::process::id()], None)
                .expect("SetPersistedDefaultAudioEndpoint should clear override back to system default");
        }
    }
}
