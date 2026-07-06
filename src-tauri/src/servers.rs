use serde::{Deserialize, Serialize};

#[derive(Debug, Clone)]
pub struct Server {
    pub name: &'static str,
    pub description: &'static str,
    pub ping_ip: &'static str,
    pub cidrs: &'static str,
    pub region: &'static str,
}

pub static SERVERS: &[Server] = &[
    Server {
        name: "USA - Central",
        description: "ORD1",
        ping_ip: "8.34.210.23",
        cidrs: "24.105.0.0/16",
        region: "USA",
    },
    Server {
        name: "USA - East",
        description: "GUE4",
        ping_ip: "34.48.0.1",
        cidrs: "8.228.64.0/18,8.234.2.0/24,8.234.128.0/17,34.4.32.0/20,34.11.0.0/17,34.21.0.0/17,34.48.0.0/16,34.85.128.0/17,34.86.0.0/16,34.104.60.0/23,34.104.124.0/23,34.118.252.0/23,34.124.60.0/23,34.127.188.0/23,34.145.128.0/17,34.150.128.0/17,34.157.0.0/21,34.157.16.0/20,34.157.128.0/21,34.157.144.0/20,34.181.128.0/17,34.182.128.0/17,34.183.12.0/22,34.183.34.0/23,34.183.60.0/24,34.183.68.0/24,34.184.12.0/22,34.184.32.0/23,34.184.59.0/24,34.184.67.0/24,34.186.32.0/19,34.186.64.0/18,35.186.160.0/19,35.188.224.0/19,35.194.64.0/19,35.199.0.0/18,35.212.0.0/17,35.220.60.0/22,35.221.0.0/18,35.230.160.0/19,35.234.176.0/20,35.236.192.0/18,35.242.60.0/22,35.243.40.0/21,35.245.0.0/16,136.23.64.0/19,136.107.0.0/16,2600:1900:4090::/44",
        region: "USA",
    },
    Server {
        name: "USA - West",
        description: "LAS1",
        ping_ip: "34.125.0.1",
        cidrs: "64.224.0.0/16",
        region: "USA",
    },
    Server {
        name: "USA - West (GCP)",
        description: "PDX1",
        ping_ip: "34.82.0.1",
        cidrs: "8.228.248.0/21,8.229.0.0/16,8.231.48.0/20,8.231.128.0/17,8.235.0.0/17,34.3.96.0/20,34.4.104.0/21,34.11.128.0/17,34.19.0.0/17,34.53.0.0/17,34.82.0.0/15,34.105.0.0/17,34.118.192.0/21,34.127.0.0/17,34.143.64.0/21,34.145.0.0/17,34.157.112.0/21,34.157.240.0/21,34.158.8.0/21,34.158.240.0/21,34.168.0.0/15,34.177.112.0/21,34.182.0.0/17,34.183.24.0/22,34.183.58.0/24,34.183.113.0/24,34.183.124.0/24,34.184.24.0/22,34.184.55.0/24,34.184.112.0/24,34.184.123.0/24,34.187.128.0/17,35.185.192.0/18,35.197.0.0/17,35.199.144.0/20,35.199.160.0/19,35.203.128.0/18,35.212.128.0/17,35.220.48.0/21,35.227.128.0/18,35.230.0.0/17,35.233.128.0/17,35.242.48.0/21,35.243.32.0/21,35.247.0.0/17,35.252.64.0/18,35.252.128.0/17,104.196.224.0/19,104.198.0.0/20,104.198.96.0/20,104.199.112.0/20,136.66.0.0/15,136.69.128.0/17,136.70.0.0/18,136.74.0.0/16,136.86.128.0/17,136.87.0.0/16,136.109.0.0/16,136.117.0.0/16,136.118.0.0/16",
        region: "USA",
    },

    Server {
        name: "Chile - GCP",
        description: "SCL1",
        ping_ip: "34.176.0.1",
        cidrs: "34.0.48.0/20,34.104.50.0/23,34.127.178.0/23,34.152.98.0/25,34.153.33.0/24,34.153.225.0/24,34.157.122.0/25,34.157.218.0/25,34.176.0.0/16,34.177.66.0/25,34.183.1.0/24,34.183.110.0/24,34.184.1.0/24,34.184.109.0/24,96.0.131.0/24,96.0.56.0/22,96.0.152.0/21,96.0.48.0/21",
        region: "South America",
    },
    Server {
        name: "Brazil - GCP",
        description: "GBR1",
        ping_ip: "34.39.128.0",
        cidrs: "34.39.128.0/17,34.95.128.0/17,34.104.80.0/21,34.124.16.0/21,34.151.0.0/18,34.151.192.0/18,35.198.0.0/18,35.199.64.0/18,35.215.192.0/18,35.220.40.0/24,35.235.0.0/20,35.242.40.0/24,35.247.192.0/18,2600:1900:40f0::/44",
        region: "South America",
    },
    Server {
        name: "Brazil - AWS",
        description: "GRU1",
        ping_ip: "3.5.232.252",
        cidrs: "56.1.0.0/16,56.5.0.0/16,64.252.81.0/24,150.222.228.0/24,52.94.198.16/28,52.93.122.203/32,63.249.157.0/24,216.198.237.0/24,99.77.149.0/24,15.230.0.12/31,64.252.79.0/24,52.93.126.235/32,63.249.158.0/24,3.4.12.49/32,52.95.240.0/24,52.93.146.0/24,18.231.0.0/16,15.228.0.0/15,54.233.0.0/18,15.221.6.0/24,56.125.0.0/16,3.4.12.32/32,18.96.64.0/19,18.229.0.0/16,15.230.0.6/31,18.230.0.0/16,15.230.73.128/26,52.93.122.202/32,15.230.197.0/24,52.93.151.0/24,35.55.26.0/24,69.107.11.72/29,56.124.128.0/17,15.230.63.2/31,150.222.69.0/24,3.2.49.0/24,63.249.159.0/24,150.222.50.224/27,1.178.95.0/24,99.77.234.0/24,35.97.176.0/20,56.124.0.0/17,16.12.2.0/24,64.66.159.0/24,35.96.43.0/24,150.222.1.0/24,151.148.18.0/24,35.50.176.0/24,99.151.112.0/21,99.82.164.0/24,64.252.78.0/24,52.93.127.70/32,150.222.9.0/24,52.93.127.161/32,35.50.177.0/24,15.251.0.20/32,15.230.250.0/24,3.4.12.31/32,173.83.213.0/24,56.127.0.0/16,13.248.114.0/24,15.177.88.0/24,56.126.0.0/16,45.33.160.0/24,52.94.248.48/28,177.72.240.0/21,15.230.0.4/32,150.222.44.160/27,15.230.100.2/32,35.98.96.0/20,54.94.0.0/16,52.93.126.234/32,52.95.164.0/23,15.177.70.0/23,150.222.12.0/24,150.222.44.96/27,35.55.27.0/24,15.251.0.25/32,64.252.80.0/24,15.230.63.10/31,15.251.0.21/32,15.230.63.6/32,52.93.127.71/32,15.230.63.0/31,52.93.126.206/32,3.4.15.152/29,69.107.7.112/29,150.222.44.128/27,54.20.0.0/15,15.193.172.0/22,54.232.0.0/16,15.230.0.14/32,54.239.0.64/28,88.104.0.0/15,54.240.244.0/22,15.251.0.23/32,15.221.132.0/22,35.55.25.0/24,150.222.28.0/24,52.93.127.160/32,52.94.7.0/24,136.18.19.0/24,15.230.0.8/31,52.93.44.0/24,150.222.70.0/24,52.93.67.0/24,16.12.0.0/23,18.228.0.0/16,15.230.252.0/24,15.251.0.22/32,3.4.15.88/29,15.221.40.0/21,15.129.42.0/23,52.93.126.207/32,52.95.163.0/24,15.230.0.5/32,52.94.206.0/23,54.233.128.0/17,35.98.112.0/20,150.222.6.0/24,15.230.100.0/31,15.129.76.0/23,15.230.63.8/31,15.230.93.0/24,3.44.192.0/18,15.230.73.0/26,15.251.0.24/32,15.230.63.4/31,16.214.48.0/22,150.222.0.0/24,52.67.0.0/16,54.233.64.0/18,35.50.178.0/24,52.46.172.0/22,3.2.80.0/24,13.248.104.0/24,52.94.148.0/22,15.230.73.64/26,3.4.12.50/32,52.95.255.0/28,150.222.51.32/27,35.71.106.0/24,15.129.30.0/24,3.5.232.0/22,54.207.0.0/16,15.220.112.0/21,177.71.128.0/17,18.229.220.192/26,18.230.229.0/24,18.230.230.0/25,54.233.255.128/26,56.125.46.0/24,56.125.47.0/32,56.125.48.0/24,3.2.49.0/24,99.82.164.0/24,13.248.114.0/24,13.248.104.0/24,15.177.88.0/24,15.177.70.0/23,15.228.126.200/29,18.231.194.8/29,15.228.129.0/24,15.228.144.0/24,15.228.151.0/24,15.228.72.64/26,15.228.97.0/24,15.229.36.0/23,15.229.40.0/23,18.229.100.0/26,18.229.99.0/24,18.230.54.0/23,15.228.104.0/24,15.228.105.0/24,15.228.106.0/24,15.228.92.192/28,15.228.92.208/28,15.228.92.224/27,18.228.1.0/29,18.228.1.16/29,18.228.1.8/29,18.229.100.128/27,18.229.100.160/27,18.229.100.192/26,18.229.37.0/27,18.229.37.32/27,18.229.70.96/27,18.231.105.0/28,18.231.105.128/27,18.231.105.160/29,18.231.105.168/29,18.231.105.176/29,18.231.105.184/29,15.228.103.240/29,15.228.126.48/30,15.229.206.194/31,15.229.206.196/30,18.228.70.32/29,15.229.206.224/31,15.229.206.228/30,15.228.126.72/30,18.229.100.112/30,18.229.100.116/30,18.230.46.0/27,18.230.46.32/27,3.44.193.128/25,15.229.120.48/29,15.229.120.56/29,52.94.7.0/24,35.71.106.0/24",
        region: "South America",
    },

    Server {
        name: "Netherlands",
        description: "AMS1",
        ping_ip: "137.221.78.60",
        cidrs: "64.224.26.0/23",
        region: "Europe",
    },
    Server {
        name: "France",
        description: "CDG1",
        ping_ip: "212.27.40.240",
        cidrs: "34.1.0.0/20,34.155.0.0/16,34.157.12.0/22,34.157.140.0/22,34.163.0.0/16,34.183.73.0/24,34.184.72.0/24",
        region: "Europe",
    },
    Server {
        name: "Germany",
        description: "FRA1",
        ping_ip: "35.198.64.1",
        cidrs: "34.0.224.0/24,34.0.226.0/24,34.40.0.0/17,34.89.128.0/17,34.104.112.0/23,34.107.0.0/17,34.118.244.0/22,34.124.48.0/23,34.141.0.0/17,34.157.48.0/20,34.157.176.0/20,34.159.0.0/16,34.179.0.0/16,34.181.0.0/17,34.183.37.0/24,34.183.82.0/24,34.184.54.0/24,34.184.81.0/24,34.185.128.0/17,35.198.64.0/18,35.198.128.0/18,35.207.64.0/18,35.207.128.0/18,35.220.18.0/23,35.234.64.0/18,35.235.32.0/20,35.242.18.0/23,35.242.192.0/18,35.246.128.0/17,136.77.128.0/17,136.92.0.0/17",
        region: "Europe",
    },
    Server {
        name: "Finland",
        description: "GEN1",
        ping_ip: "34.88.0.1",
        cidrs: "34.88.0.0/16,34.104.96.0/21,34.124.32.0/21,35.203.232.0/21,35.217.0.0/18,35.220.26.0/24,35.228.0.0/16,35.242.26.0/24,2600:1900:4150::/44",
        region: "Europe",
    },

    Server {
        name: "Tokyo",
        description: "GTK1",
        ping_ip: "34.84.0.0",
        cidrs: "34.84.0.0/16,34.85.0.0/17,34.104.62.0/23,34.104.128.0/17,34.127.190.0/23,34.146.0.0/16,34.153.192.0/19,34.157.64.0/20,34.157.164.0/22,34.157.192.0/20,34.180.64.0/18,35.187.192.0/19,35.189.128.0/19,35.190.224.0/20,35.194.96.0/19,35.200.0.0/17,35.213.0.0/17,35.220.56.0/22,35.221.64.0/18,35.230.240.0/20,35.242.56.0/22,35.243.64.0/18,104.198.80.0/20,104.198.112.0/20,136.110.64.0/18,2600:1900:4050::/44",
        region: "Asia",
    },
    Server {
        name: "South Korea",
        description: "ICN1",
        ping_ip: "34.64.64.15",
        cidrs: "110.45.208.0/24,117.52.6.0/24,117.52.26.0/23,117.52.28.0/23,117.52.33.0/24,117.52.34.0/23,117.52.36.0/23,121.254.137.0/24,121.254.206.0/23,121.254.218.0/24,182.162.31.0/24",
        region: "Asia",
    },
    Server {
        name: "Taiwan",
        description: "TPE1",
        ping_ip: "168.95.1.1",
        cidrs: "5.42.160.0/22,5.42.164.0/22",
        region: "Asia",
    },
    Server {
        name: "Singapore",
        description: "GSG1",
        ping_ip: "34.1.128.4",
        cidrs: "34.1.128.0/20,34.1.192.0/20,34.2.16.0/20,34.2.128.0/17,34.21.128.0/17,34.87.0.0/17,34.87.128.0/18,34.104.58.0/23,34.104.106.0/23,34.124.42.0/23,34.124.128.0/17,34.126.64.0/18,34.126.128.0/18,34.128.44.0/23,34.128.60.0/23,34.142.128.0/17,34.143.128.0/17,34.152.104.0/23,34.153.40.0/23,34.153.232.0/23,34.157.82.0/23,34.157.88.0/23,34.157.210.0/23,34.158.32.0/19,34.177.72.0/23,34.177.80.0/20,34.177.96.0/20,34.183.80.0/24,34.184.75.0/24,35.185.176.0/20,35.186.144.0/20,35.187.224.0/19,35.197.128.0/19,35.198.192.0/18,35.213.128.0/18,35.220.24.0/23,35.234.192.0/20,35.240.128.0/17,35.242.24.0/23,35.247.128.0/18,136.110.0.0/18,2600:1900:4080::/44",
        region: "Asia",
    },
];

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServerState {
    pub name: &'static str,
    pub description: &'static str,
    pub ping_ip: &'static str,
    pub cidrs: String,
    pub region: &'static str,
    pub is_blocked: bool,
    pub current_ping: Option<u32>,
}

#[derive(Debug, Deserialize)]
struct GcpPrefix {
    #[serde(rename = "ipv4Prefix")]
    ipv4_prefix: Option<String>,
    #[serde(rename = "ipv6Prefix")]
    ipv6_prefix: Option<String>,
    scope: String,
}

#[derive(Debug, Deserialize)]
struct GcpIpRanges {
    prefixes: Vec<GcpPrefix>,
}

fn is_valid_cidr(cidr: &str) -> bool {
    let parts: Vec<&str> = cidr.split('/').collect();
    if parts.len() != 2 {
        return false;
    }
    let ip_part = parts[0];
    let mask_part = parts[1];

    let ip_parsed = ip_part.parse::<std::net::IpAddr>().is_ok();
    let mask_parsed = mask_part.parse::<u8>().map(|m| m <= 128).unwrap_or(false);

    ip_parsed && mask_parsed
}

pub async fn load_dynamic_gcp_cidrs(servers: &mut [ServerState]) -> Result<(), String> {
    let url = "https://www.gstatic.com/ipranges/cloud.json";
    let response = reqwest::get(url).await.map_err(|e| e.to_string())?;
    let ip_ranges = response
        .json::<GcpIpRanges>()
        .await
        .map_err(|e| e.to_string())?;

    fn get_scopes_for_desc(desc: &str) -> Vec<&str> {
        match desc {
            "ORD1" => vec!["us-central1"],
            "GUE4" => vec!["us-east4", "us-east1"],
            "LAS1" => vec!["us-west4"],
            "PDX1" => vec!["us-west1", "us-west2"],
            "SCL1" => vec!["southamerica-west1"],
            "GBR1" => vec!["southamerica-east1"],
            "AMS1" => vec!["europe-west4"],
            "CDG1" => vec!["europe-west9"],
            "FRA1" => vec!["europe-west3"],
            "GEN1" => vec!["europe-north1"],
            "GTK1" => vec!["asia-northeast1"],
            "ICN1" => vec!["asia-northeast3"],
            "TPE1" => vec!["asia-east1"],
            "GSG1" => vec!["asia-southeast1"],
            _ => vec![],
        }
    }

    let mut updated_count = 0;
    for server in servers.iter_mut() {
        let target_scopes = get_scopes_for_desc(server.description);
        if target_scopes.is_empty() {
            continue;
        }

        let mut matched_cidrs = Vec::new();
        for prefix in &ip_ranges.prefixes {
            if target_scopes.contains(&prefix.scope.as_str()) {
                if let Some(ref ipv4) = prefix.ipv4_prefix {
                    if is_valid_cidr(ipv4) {
                        matched_cidrs.push(ipv4.clone());
                    } else {
                        crate::logger::error(&format!(
                            "Security Warning: Malformed/Invalid IPv4 CIDR filtered out: {}",
                            ipv4
                        ));
                    }
                }
                if let Some(ref ipv6) = prefix.ipv6_prefix {
                    if is_valid_cidr(ipv6) {
                        matched_cidrs.push(ipv6.clone());
                    } else {
                        crate::logger::error(&format!(
                            "Security Warning: Malformed/Invalid IPv6 CIDR filtered out: {}",
                            ipv6
                        ));
                    }
                }
            }
        }

        if !matched_cidrs.is_empty() {
            server.cidrs = matched_cidrs.join(",");
            updated_count += 1;
        }
    }

    crate::logger::info(&format!(
        "Successfully loaded dynamic GCP IP ranges for {} servers.",
        updated_count
    ));
    Ok(())
}

#[derive(Debug, Deserialize)]
struct AwsPrefix {
    #[serde(rename = "ip_prefix")]
    ip_prefix: Option<String>,
    region: String,
    service: String,
}

#[derive(Debug, Deserialize)]
struct AwsIpv6Prefix {
    #[serde(rename = "ipv6_prefix")]
    ipv6_prefix: Option<String>,
    region: String,
    service: String,
}

#[derive(Debug, Deserialize)]
struct AwsIpRanges {
    prefixes: Vec<AwsPrefix>,
    #[serde(rename = "ipv6_prefixes")]
    ipv6_prefixes: Vec<AwsIpv6Prefix>,
}

fn get_aws_regions_for_desc(desc: &str) -> Vec<&str> {
    match desc {
        "ORD1" => vec!["us-east-2"], // Ohio
        "GUE4" => vec!["us-east-1"], // N. Virginia
        "PDX1" => vec!["us-west-1", "us-west-2"], // N. California, Oregon
        "GRU1" => vec!["sa-east-1"], // São Paulo
        "AMS1" => vec!["eu-west-1", "eu-west-2"], // Ireland, London
        "CDG1" => vec!["eu-west-3"], // Paris
        "FRA1" => vec!["eu-central-1"], // Frankfurt
        "GEN1" => vec!["eu-north-1"], // Stockholm
        "GTK1" => vec!["ap-northeast-1"], // Tokyo
        "ICN1" => vec!["ap-northeast-2"], // Seoul
        "GSG1" => vec!["ap-southeast-1"], // Singapore
        _ => vec![],
    }
}

pub async fn load_dynamic_aws_cidrs(servers: &mut [ServerState]) -> Result<(), String> {
    let url = "https://ip-ranges.amazonaws.com/ip-ranges.json";
    let response = reqwest::get(url).await.map_err(|e| e.to_string())?;
    let ip_ranges = response
        .json::<AwsIpRanges>()
        .await
        .map_err(|e| e.to_string())?;

    let mut updated_count = 0;
    for server in servers.iter_mut() {
        let target_regions = get_aws_regions_for_desc(server.description);
        if target_regions.is_empty() {
            continue;
        }

        let mut matched_cidrs = Vec::new();
        if !server.cidrs.is_empty() {
            for c in server.cidrs.split(',') {
                let trimmed = c.trim().to_string();
                if !trimmed.is_empty() {
                    matched_cidrs.push(trimmed);
                }
            }
        }

        for prefix in &ip_ranges.prefixes {
            if target_regions.contains(&prefix.region.as_str()) && prefix.service == "EC2" {
                if let Some(ref ipv4) = prefix.ip_prefix {
                    if is_valid_cidr(ipv4) {
                        matched_cidrs.push(ipv4.clone());
                    } else {
                        crate::logger::error(&format!(
                            "Security Warning: Malformed/Invalid AWS IPv4 CIDR filtered out: {}",
                            ipv4
                        ));
                    }
                }
            }
        }
        for prefix in &ip_ranges.ipv6_prefixes {
            if target_regions.contains(&prefix.region.as_str()) && prefix.service == "EC2" {
                if let Some(ref ipv6) = prefix.ipv6_prefix {
                    if is_valid_cidr(ipv6) {
                        matched_cidrs.push(ipv6.clone());
                    } else {
                        crate::logger::error(&format!(
                            "Security Warning: Malformed/Invalid AWS IPv6 CIDR filtered out: {}",
                            ipv6
                        ));
                    }
                }
            }
        }

        if !matched_cidrs.is_empty() {
            matched_cidrs.sort();
            matched_cidrs.dedup();
            server.cidrs = matched_cidrs.join(",");
            updated_count += 1;
        }
    }

    crate::logger::info(&format!(
        "Successfully loaded dynamic AWS IP ranges for {} servers.",
        updated_count
    ));
    Ok(())
}
