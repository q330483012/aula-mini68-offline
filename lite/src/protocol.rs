pub fn supported(vendor: u16, product: u16, page: u16, usage: u16) -> bool {
    ((vendor == 14502 && (10018..=10020).contains(&product))
        || (vendor == 10406 && product == 10018))
        && page == 0xff68
        && usage == 0x61
}

pub fn wire_report(report_id: u8, data: &[u8], read_only: bool) -> Result<Vec<u8>, String> {
    if report_id != 0 || !(8..=64).contains(&data.len()) || data[0] != 170 {
        return Err("配置接口仅接受 reportId=0 的 8 至 64 字节数据包".into());
    }
    if read_only && ![0, 16, 17, 18, 19, 20, 21, 22, 23, 24, 27, 28].contains(&data[1]) {
        return Err(format!("只读验证模式拦截写入命令 {}", data[1]));
    }
    let mut wire = Vec::with_capacity(65);
    wire.push(report_id);
    wire.extend_from_slice(data);
    wire.resize(65, 0);
    Ok(wire)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn never_selects_keyboard_consumer_or_firmware_collections() {
        assert!(supported(14502, 10020, 0xff68, 0x61));
        for (vendor, product, page, usage) in [
            (14502, 10020, 1, 6),
            (14502, 10020, 12, 1),
            (14502, 10020, 0xff67, 1),
            (14502, 65276, 0xff68, 0x61),
            (1, 10020, 0xff68, 0x61),
        ] {
            assert!(!supported(vendor, product, page, usage));
        }
    }
    #[test]
    fn windows_report_prefix_does_not_shift_vendor_payload() {
        let mut data = [0u8; 64];
        data[0] = 170;
        data[1] = 18;
        data[63] = 99;
        let wire = wire_report(0, &data, true).unwrap();
        assert_eq!(wire.len(), 65);
        assert_eq!(wire[0], 0);
        assert_eq!(&wire[1..], &data);
        assert!(wire_report(1, &data, false).is_err());
        let short = wire_report(0, &data[..8], true).unwrap();
        assert_eq!(&short[1..9], &data[..8]);
        assert!(short[9..].iter().all(|b| *b == 0));
        assert!(wire_report(0, &data[..7], false).is_err());
        data[1] = 50;
        assert!(wire_report(0, &data, true).is_err());
        assert!(wire_report(0, &data, false).is_ok());
    }
}
