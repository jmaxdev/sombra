use std::net::Ipv4Addr;
use std::time::Duration;
use windows::Win32::NetworkManagement::IpHelper::{
    IcmpCloseHandle, IcmpCreateFile, IcmpSendEcho, ICMP_ECHO_REPLY,
};

#[repr(C, align(8))]
struct ReplyBuffer {
    reply: ICMP_ECHO_REPLY,
    padding: [u8; 64], // Sufficient padding for 32-byte request payload + 8-byte ICMP header/error buffer
}

pub fn ping_ipv4(ip: Ipv4Addr, timeout: Duration) -> Option<u32> {
    unsafe {
        let handle = match IcmpCreateFile() {
            Ok(h) => h,
            Err(_) => return None,
        };

        if handle.is_invalid() {
            return None;
        }

        // Convert Ipv4Addr to u32 in network byte order
        let destination = u32::from_ne_bytes(ip.octets());

        // Standard 32-byte dummy payload to send
        let request_data = [0u8; 32];

        let mut reply_buf = ReplyBuffer {
            reply: std::mem::zeroed(),
            padding: [0u8; 64],
        };

        let reply_size = std::mem::size_of::<ReplyBuffer>() as u32;

        let result = IcmpSendEcho(
            handle,
            destination,
            request_data.as_ptr() as *const _,
            request_data.len() as u16,
            None,
            &mut reply_buf as *mut ReplyBuffer as *mut _,
            reply_size,
            timeout.as_millis() as u32,
        );

        let _ = IcmpCloseHandle(handle);

        if result > 0 && reply_buf.reply.Status == 0 {
            Some(reply_buf.reply.RoundTripTime)
        } else {
            None
        }
    }
}
