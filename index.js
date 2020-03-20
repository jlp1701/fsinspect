'use strict';

let fs = require("fs");
let util = require("util");
let crc = require("crc");

function onLoadImage() {
    let imgPath = document.getElementById("imgPath").value;
    let sectorSize =  parseInt(document.getElementById("sectorSize").value);
    console.log("Loading image:", imgPath);
    
    clearLoadImgErrMsg();
    clearParitionList();
    clearDetailedView();

    // clear displayed partitions
    let mbr = null;
    try {
        mbr = tryParseMbr(imgPath);    
    } catch (error) {
        console.log(error);
        setLoadImgErrorMsg(error);
        return;
    }

    // check if gpt partition
    let numPart = 0;
    mbr.partitionList.forEach(p => {
        if (p.numSectors > 0 ) {
            numPart++;
        }
    });
    if (numPart != 1 || mbr.partitionList[0].partType != 0xEE) {
        // MBR scheme
        let mbrDisk = parseDiskWithMBR(imgPath, sectorSize);

        let partList = document.getElementById("partList");
        partList.appendChild(createPartitionElement(mbrDisk.mbr, sectorSize));
    
        for (const p of mbrDisk.partitions) {
            partList.appendChild(createPartitionElement(p, sectorSize));
        }

    } else {
        // GPT scheme
        let gptDisk = parseDiskWithGPT(imgPath, sectorSize);

        let partList = document.getElementById("partList");
        partList.appendChild(createPartitionElement(mbr, sectorSize));
        partList.appendChild(createPartitionElement(gptDisk.primaryGPT.header, sectorSize));
        partList.appendChild(createPartitionElement(gptDisk.primaryGPT.partitionList, sectorSize));
    
        for (const p of gptDisk.partitions) {
            partList.appendChild(createPartitionElement(p, sectorSize));
            try {
                let FAT32Volume = tryParseFAT32(p.imgPath, p.offset, p.size, sectorSize);
                p.children.push(FAT32Volume);
            } catch (error) {
                console.log(`Error while trying to parse FAT32 volume: ${error}`);
            }
        }

        partList.appendChild(createPartitionElement(gptDisk.secondaryGPT.partitionList, sectorSize));
        partList.appendChild(createPartitionElement(gptDisk.secondaryGPT.header, sectorSize));
        
    }

/*     // check if disk has GPT
    try {
        tryParseGPT(imgPath, sectorSize);
    } catch (error) {
        console.log(error);
        setLoadImgErrorMsg(error);
        return;
    }

    // analyze paritions
    let i = 1;
    for (const p of mbr.partitionList) {
        if (p.numSectors > 0) {
            let pDs = new DataSection(imgPath, p.startLBA*sectorSize, p.numSectors*sectorSize, `Partition #${i++}`, hexArray, "First Partition");
            partList.appendChild(createPartitionElement(pDs, sectorSize));
            // check if any filesystem is on partition

            // if yes, then parse filesystem
        }
    } */

};

function setLoadImgErrorMsg(msg) {
    let err = document.getElementById("loadImageErrorMsg");
    err.innerText = msg;
    err.classList.remove("hidden");
}

function clearLoadImgErrMsg() {
    document.getElementById("loadImageErrorMsg").classList.add("hidden");
}

function parseDiskWithMBR(imgPath, sectorSize) {

    let mbr = tryParseMbr(imgPath);

    // create DataSections for partitions
    let partitions = [];
    let i = 0;
    for (const p of mbr.partitionList) {
        let parOffset = p.startLBA * sectorSize;
        let partSize = p.numSectors * sectorSize;
        if (partSize > 0) {
            partitions.push(new DataSection(imgPath, parOffset, partSize, `Partition #${++i}`, hexArray, ""));
        }
    }
    return {
        mbr: mbr,
        partitions, partitions
    };
}

// checks if image has Msdos/MBR or GPT partition scheme or invalid
function tryParseMbr(imgPath) {
    let mbr = createMbrTemplate(imgPath);
    let sig = mbr.children[mbr.children.length-1].value;
    if (sig != 0x55AA) {
        throw "Wrong signature: " + sig;
    }
    mbr.signature = sig;

    // set boot code
    mbr.bootCode = mbr.children[0].value;

    // parse partition entries
    let pList = [];
    for (let i = 0; i < 4; i++) {
        let dsP = mbr.children[i+1];
        let p = {};
        p.status = dsP.children[0].value;
        p.startCHS = dsP.children[1].value;
        p.partType = dsP.children[2].value;
        p.endCHS = dsP.children[3].value;
        p.startLBA = dsP.children[4].value;
        p.numSectors = dsP.children[5].value;
        pList.push(p);    
    }
    mbr.partitionList = pList;

    return mbr;
}

// analyze master boot record (sector 0 of image)
function createMbrTemplate(imgPath) {
    let mbr = new DataSection(imgPath, 0, 512, "MBR", hexArray, "Master Boot Record");
    mbr.children.push(new DataSection(imgPath, 0, 446, "Boot code", hexArray, "Bootstrap code area"));
    mbr.children.push(addMBRPartitionEntry(new DataSection(imgPath, 446, 16, "Partition Entry #1", hexArray, "")));
    mbr.children.push(addMBRPartitionEntry(new DataSection(imgPath, 462, 16, "Partition Entry #2", hexArray, "")));
    mbr.children.push(addMBRPartitionEntry(new DataSection(imgPath, 478, 16, "Partition Entry #3", hexArray, "")));
    mbr.children.push(addMBRPartitionEntry(new DataSection(imgPath, 494, 16, "Partition Entry #4", hexArray, "")));
    mbr.children.push(new DataSection(imgPath, 510, 2, "Signature", uintBE,  "The signature"));

    return mbr;
};

function parseDiskWithGPT(imgPath, sectorSize) {
    
    let mbr = tryParseMbr(imgPath);
    // check if only one partition is used (protective mbr)
    let numPart = 0;
    mbr.partitionList.forEach(p => {
        if (p.numSectors > 0 ) {
            numPart++;
        }
    });
    if (numPart != 1 || mbr.partitionList[0].partType != 0xEE) {
        throw "Protective MBR invalid!";
    }

    // parse primary and secondary GPT
    let primaryGPT = tryParseGPT(imgPath, sectorSize, sectorSize*1);
    let secondaryGPT = tryParseGPT(imgPath, sectorSize, sectorSize*primaryGPT.header.backupLBA);

    // create DataSections for partitions
    let partitions = [];
    for (const p of primaryGPT.partitionList.children) {
        let firstLBA = p.children[2].value;
        let lastLBA = p.children[3].value;
        let size = (lastLBA - firstLBA + 1) * sectorSize;
        partitions.push(new DataSection(imgPath, firstLBA * sectorSize, size, p.name, hexArray, ""));
    }

    return {
        // protectiveMBR
        primaryGPT: primaryGPT,
        partitions: partitions,
        secondaryGPT: secondaryGPT,
    };
}

function tryParseGPT(imgPath, sectorSize, offset) {

    // Protective MBR is valid; Try to parse GPT header
    let gptHeader = tryParseGptHeader(imgPath, sectorSize, offset);

    // parse partition entries
    let {partitionList, crc32} = tryParseGptPartitionArray(imgPath, sectorSize, gptHeader.partitionEntriesLBA*sectorSize, gptHeader.numPartEntries, gptHeader.sizePartEntry);

    // verify CRC32 of partition array
    if (crc32 != gptHeader.crc32PartEntries) {
        throw `CRC32 mismatch for GPT partitions. Read: ${gptHeader.crc32PartEntries}; calculated: ${crc32}`;
    }
    
    return {
        header: gptHeader,
        partitionList: partitionList
    };
}

function tryParseGptHeader(imgPath, sectorSize, offset) {
    let gptHeader = createGptHeaderTemplate(imgPath, sectorSize, offset);
    // check GPT signature
    let gptSig = gptHeader.children[0].value;
    if (gptSig != "EFI PART") {
        throw `Wrong GPT signature: ${gptSig}`;
    }
    gptHeader.signature = gptSig;
    // check header size 
    let headerSize = gptHeader.children[2].value;
    if (headerSize != 92) {
        throw `Header size value (${headerSize}) not matching with real header size (${92})`;
    }
    gptHeader.headerSize = headerSize;
    
    // check CRC32 for gpt header
    let crc32Header = gptHeader.children[3].value;
    let headerData = gptHeader.readData(gptHeader.offset, headerSize);
    for (let i = 0; i < 4; i++) {
        headerData[16 + i] = 0;  // clear current CRC32 value 
    }
    let computedCrc = crc.crc32(headerData);
    if (computedCrc != crc32Header) {
        throw `CRC32 mismatch for GPT header. Read: ${crc32Header}; calculated: ${computedCrc}`;
    }
    gptHeader.crc32Header = crc32Header;

    gptHeader.currentLBA = gptHeader.children[5].value;
    gptHeader.backupLBA = gptHeader.children[6].value;
    gptHeader.firstUsableLBA = gptHeader.children[7].value;
    gptHeader.lastUsableLBA = gptHeader.children[8].value;
    gptHeader.diskGUID = gptHeader.children[9].value;
    gptHeader.partitionEntriesLBA = gptHeader.children[10].value;
    gptHeader.numPartEntries = gptHeader.children[11].value;
    gptHeader.sizePartEntry = gptHeader.children[12].value;
    gptHeader.crc32PartEntries = gptHeader.children[13].value;
    return gptHeader;
}

function createGptHeaderTemplate(imgPath, sectorSize, offset) {
    let gptHeader = new DataSection(imgPath, offset, sectorSize*1, "GPT Header", hexArray, "");
    gptHeader.children.push(new DataSection(imgPath, offset + 0, 8, "Signature", ascii, ""));
    gptHeader.children.push(new DataSection(imgPath, offset + 8, 4, "Revision", hexArray, ""));
    gptHeader.children.push(new DataSection(imgPath, offset + 12, 4, "Header size", uintLE, "in bytes"));
    gptHeader.children.push(new DataSection(imgPath, offset + 16, 4, "CRC32 of header", uintLE, ""));
    gptHeader.children.push(new DataSection(imgPath, offset + 20, 4, "Reserved", uintLE, "must be zero"));
    gptHeader.children.push(new DataSection(imgPath, offset + 24, 8, "Current LBA", uintLE, "location of this header copy"));
    gptHeader.children.push(new DataSection(imgPath, offset + 32, 8, "Backup LBA", uintLE, "location of the other header copy"));
    gptHeader.children.push(new DataSection(imgPath, offset + 40, 8, "First LBA for partitions", uintLE, ""));
    gptHeader.children.push(new DataSection(imgPath, offset + 48, 8, "Last usable LBA for paritions", uintLE, ""));
    gptHeader.children.push(new DataSection(imgPath, offset + 56, 16, "Disk GUID", guid, ""));
    gptHeader.children.push(new DataSection(imgPath, offset + 72, 8, "Start LBA of partition entries", uintLE, ""));
    gptHeader.children.push(new DataSection(imgPath, offset + 80, 4, "Number of partition entries", uintLE, ""));
    gptHeader.children.push(new DataSection(imgPath, offset + 84, 4, "Size of partition entry", uintLE, ""));
    gptHeader.children.push(new DataSection(imgPath, offset + 88, 4, "CRC32 of partition entries array", uintLE, ""));
    gptHeader.children.push(new DataSection(imgPath, offset + 92, sectorSize-92, "Reserved", uintLE, "must be zeros"));
    return gptHeader;
}

function tryParseGptPartitionArray(imgPath, sectorSize, offset, numPartEntries, sizePartEntry){
    let dsPartitionList = new DataSection(imgPath, offset, numPartEntries*sizePartEntry, "Partition Array", hexArray, "");    

    for (let i = 0; i < numPartEntries; i++) {
        let p = addGPTPartitionEntry(new DataSection(imgPath, offset + i*sizePartEntry, sizePartEntry, `Partition Entry #${i+1}`, hexArray, ""));
        //crcData = crcData.concat(p.value)
        if (p.children[0].value != "00000000-0000-0000-0000-000000000000") {
            dsPartitionList.children.push(p);
        }
    }
    let computedCrc = crc.crc32(dsPartitionList.readData(dsPartitionList.offset, numPartEntries*sizePartEntry));

    return {
        partitionList: dsPartitionList,
        crc32: computedCrc
    };
}

function addGPTPartitionEntry(ds) {
    let offset = ds.offset;
    let imgPath = ds.imgPath;
    // parse entry
    ds.children.push(new DataSection(imgPath, offset + 0, 16, "Partition Type GUID", guid, ""));
    ds.children.push(new DataSection(imgPath, offset + 16, 16, "Unique partition GUID", guid, ""));
    ds.children.push(new DataSection(imgPath, offset + 32, 8, "First LBA", uintLE, ""));
    ds.children.push(new DataSection(imgPath, offset + 40, 8, "Last LBA", uintLE, "inclusive"));
    ds.children.push(new DataSection(imgPath, offset + 48, 8, "Attribute Flags", uintLE, ""));
    ds.children.push(new DataSection(imgPath, offset + 56, 72, "Partition name", utf16, ""));
    return ds;   
}

function addMBRPartitionEntry(ds) {
    let offset = ds.offset;
    let imgPath = ds.imgPath;
    // 0,1 status
    ds.children.push(new DataSection(imgPath, offset+0, 1, "Status", uintLE, "Status of the Partition"));
    // 1,3 CHS address of start sector
    ds.children.push(new DataSection(imgPath, offset+1, 3, "CHS Start", hexArray, "CHS Start Sector of partition"));
    // 4,1 Parition type
    ds.children.push(new DataSection(imgPath, offset+4, 1, "Partition type", uintLE, ""));
    // 5,3 CHS address of last sector
    ds.children.push(new DataSection(imgPath, offset+5, 3, "CHS End", hexArray, "CHS Last Sector of partition"));
    // 8,4 LBA of first sector
    ds.children.push(new DataSection(imgPath, offset+8, 4, "LBA Start", uintLE, "LBA of first sector"));
    // 12,4 Number of sectors in partition
    ds.children.push(new DataSection(imgPath, offset+12, 4, "Number of sectors", uintLE, "Size of partition in sectors"));
    return ds;
}


function clearParitionList() {
    let ul = document.getElementById("partList");
    while(ul.firstChild) ul.removeChild(ul.firstChild);
}

function createPartitionElement(ds, sectorSize) {
    let item = document.createElement("li");
    item.classList.add("sectordesc");
    item.innerHTML = "<div>" + ds.name + "</div>";
    item.innerHTML += "<div>" + "Sector Offset: " + ds.offset / sectorSize + "</div>";
    item.innerHTML += "<div>" + "Num of Sectors: " + ds.size / sectorSize + "</div>";
    item.onclick = (() => {
        clearDetailedView();
        createDetailedView(ds);
    });
    return item;
}

function tryParseFAT32(imgPath, offset, size, sectorSize) {
    // parse reserved area
    // parse boot sector
    let dsBootSector = createFAT32BootSectorTemplate(imgPath, offset, sectorSize);
    // get number of sectors of reserved area
    let sectorsResArea = dsBootSector.children[4].value;
    let dsReservedArea = new DataSection(imgPath, offset, sectorsResArea * sectorSize, "Reserved Area", hexArray, "");
    dsReservedArea.children.push(dsBootSector);

    // check if FAT version (offset 0x52, len 8) == "FAT32   "
    let FATVersion = dsBootSector.children[26].value;
    if (FATVersion != "FAT32   ") {
        throw `Wrong FAT version: ${FATVersion}.`;
    }

    // parse all FATs
    let sectorsPerFAT = dsBootSector.children[14].value;
    let numFATs = dsBootSector.children[5].value;
    let totalSectors = dsBootSector.children[7].value;
    if (totalSectors == 0) { // check if number of sectors is > 2^16
        totalSectors = dsBootSector.children[13].value;
    }
    let dsFATArea = new DataSection(imgPath, offset + sectorsResArea * sectorSize, numFATs * sectorsPerFAT * sectorSize, "FAT Area", hexArray, "Contains all FAT copies");
    for (let i = 0; i < numFATs; i++) {
        let dsFAT = tryParseFAT(imgPath, dsFATArea.offset + i * sectorsPerFAT * sectorSize, sectorsPerFAT * sectorSize);
        dsFATArea.children.push(dsFAT);
    }

    // parse data area
    let dsDataArea = new DataSection(imgPath, dsFATArea.offset + dsFATArea.size, totalSectors * sectorSize - (dsReservedArea.size + dsFATArea.size), "Data Area", hexArray, "");
    let dsFAT32 = new DataSection(imgPath, offset, dsReservedArea.size + dsFATArea.size + dsDataArea.size, "FAT32 file system", hexArray, "");
    dsFAT32.children.push(dsReservedArea);
    dsFAT32.children.push(dsFATArea);
    dsFAT32.children.push(dsDataArea);
    return dsFAT32;
}

function createFAT32BootSectorTemplate(imgPath, offset, sectorSize) {
    let dsBootSector = new DataSection(imgPath, offset, sectorSize*1, "boot sector", hexArray, ""); // size can be adjusted as it can be changed within the boot sector
    dsBootSector.children.push(new DataSection(imgPath, offset + 0x00, 3, "machine code", hexArray, "Typically used to jump to boot code."));
    dsBootSector.children.push(new DataSection(imgPath, offset + 0x03, 8, "OEM name", ascii, "Padded with spaces."));
    dsBootSector.children.push(new DataSection(imgPath, offset + 0x0B, 2, "Bytes per sector", uintLE, "Valid values are 512, 1024, 2048, 4096."));
    dsBootSector.children.push(new DataSection(imgPath, offset + 0x0D, 1, "Sectors per cluster", uintLE, "Value is power of two between 1 and 64 (sometimes also 128)."));
    dsBootSector.children.push(new DataSection(imgPath, offset + 0x0E, 2, "Number of sectors of reserved area", uintLE, "Inlcuding boot sector"));
    dsBootSector.children.push(new DataSection(imgPath, offset + 0x10, 1, "Number of FAT copies", uintLE, ""));
    dsBootSector.children.push(new DataSection(imgPath, offset + 0x11, 2, "Max entries in root dir", uintLE, "Unused"));
    dsBootSector.children.push(new DataSection(imgPath, offset + 0x13, 2, "Max number of sectors", uintLE, "Unused"));
    dsBootSector.children.push(new DataSection(imgPath, offset + 0x15, 1, "Media Descriptor Byte", uintLE, "Deprecated"));
    dsBootSector.children.push(new DataSection(imgPath, offset + 0x16, 2, "Number of sectors per FAT", uintLE, "Unused"));
    dsBootSector.children.push(new DataSection(imgPath, offset + 0x18, 2, "Sectors per track", uintLE, ""));
    dsBootSector.children.push(new DataSection(imgPath, offset + 0x1A, 2, "Number of heads", uintLE, ""));
    dsBootSector.children.push(new DataSection(imgPath, offset + 0x1C, 4, "Number of hidden sectors", uintLE, ""));
    dsBootSector.children.push(new DataSection(imgPath, offset + 0x20, 4, "Number of total sectors", uintLE, ""));
    dsBootSector.children.push(new DataSection(imgPath, offset + 0x24, 4, "Number of sectors per FAT", uintLE, ""));
    dsBootSector.children.push(new DataSection(imgPath, offset + 0x28, 2, "FAT flags", hexArray, ""));
    dsBootSector.children.push(new DataSection(imgPath, offset + 0x2A, 2, "FAT32 version", uintLE, ""));
    dsBootSector.children.push(new DataSection(imgPath, offset + 0x2C, 4, "Cluster number of root dir", uintLE, ""));
    dsBootSector.children.push(new DataSection(imgPath, offset + 0x30, 2, "Sector of FS information sector", uintLE, ""));
    dsBootSector.children.push(new DataSection(imgPath, offset + 0x32, 2, "Sector of boot sector copy", uintLE, ""));
    dsBootSector.children.push(new DataSection(imgPath, offset + 0x34, 12, "reserved", hexArray, ""));
    dsBootSector.children.push(new DataSection(imgPath, offset + 0x40, 1, "Physical BIOS volume number", uintLE, ""));
    dsBootSector.children.push(new DataSection(imgPath, offset + 0x41, 1, "reserved", uintLE, ""));
    dsBootSector.children.push(new DataSection(imgPath, offset + 0x42, 1, "extended boot signature", hexArray, ""));
    dsBootSector.children.push(new DataSection(imgPath, offset + 0x43, 4, "Serial ID", uintLE, ""));
    dsBootSector.children.push(new DataSection(imgPath, offset + 0x47, 11, "Name of file system", hexArray, "Unused"));
    dsBootSector.children.push(new DataSection(imgPath, offset + 0x52, 8, "FAT version", ascii, "Always 'FAT32   '"));
    dsBootSector.children.push(new DataSection(imgPath, offset + 0x5A, 420, "Boot code", hexArray, ""));
    dsBootSector.children.push(new DataSection(imgPath, offset + 0x1FE, 2, "Boot signature", uintLE, ""));

    return dsBootSector;
}

function tryParseFAT(imgPath, offset, size) {
    let dsFAT = new DataSection(imgPath, offset, size, "FAT", hexArray, "");
    for (let entryOffset = 0; entryOffset < size; entryOffset += 4) {
        let FATEntry = new DataSection(imgPath, offset + entryOffset, 4, "FAT Entry", uintLE, "");
        if (FATEntry.value != 0) {
            dsFAT.children.push(FATEntry);
        }
    }
    console.log(`Number of non-empty FAT entries: ${dsFAT.children.length}`);
    return dsFAT;
}

function clearDetailedView() {
    let tBody = document.getElementById("detailsBody");
    while (tBody.firstChild) tBody.removeChild(tBody.firstChild);
    
}

function createDetailedView(ds) {
    let old_tbody = document.getElementById("detailsBody");
    let new_tbody = old_tbody.cloneNode();
    
    old_tbody.parentNode.replaceChild(new_tbody, old_tbody);
    let childs = dsToTableRows(new_tbody, ds);
}

function dsToTableRows(tBody, ds) {
    let row = tBody.insertRow(-1);
    dsFillRow(row, ds);
    let node = {};
    node.row = row;
    
    node.children = [];
    ds.children.forEach(element => {
        node.children.push(dsToTableRows(tBody, element));
    });
    
    if (node.children.length > 0) {
        node.collapsed = false;
        row.classList.add("expandable");
        row.onclick = ( function (){
            
            if (node.collapsed) {
                let nodes = getSubnodes(node, 1);
                nodes.forEach(element => {
                    element.row.classList.remove("hidden");
                });
                node.collapsed = false;
            }
            else {
                let nodes = getSubnodes(node);
                nodes.forEach(element => {
                    if (element.hasOwnProperty("collapsed")) {
                        element.collapsed = true;
                    }
                    element.row.classList.add("hidden");
                });
                node.collapsed = true;
            }
        });    
    }    

    return node;
}

function getSubnodes(node, levels = -1) {
    let list = []
    
    if (levels != -1) {
        levels--;
        if (levels < 0) return [];
    }

    node.children.forEach(element => {
        list.push(element);
        let subnodes = (getSubnodes(element, levels));
        subnodes.forEach(element => {
            list.push(element);
        });
    });
    return list;
}

function dsFillRow(row, ds) {
    row.insertCell(-1).innerHTML = ds.offset;
    row.insertCell(-1).innerHTML = ds.size;
    row.insertCell(-1).innerHTML = ds.name;

    let valRow = row.insertCell(-1);
    valRow.classList.add("value");
    if (ds.valueType == hexArray && ds.size > 32)
        valRow.innerHTML = ds.value.slice(0, 32).concat(["..."]);
    else
        valRow.innerHTML = ds.value.toString(16).toUpperCase();

    row.insertCell(-1).innerHTML = ds.desc;
}

/* class PartInfo {
    constructor(name, startSector, numSectors) {
        this.name = name;
        this.startSector = startSector;
        this.numSectors = numSectors;
    }
} */

/* class PartitionScheme {
    constructor() {
        this.pInfoList = [];
    }
}
 */

class DataSection {
    constructor(imgPath, offset, size, name, valueType, desc) {
        this.imgPath = imgPath;
        this.offset = offset;
        this.size = size;
        this.name = name;
        this.valueType = valueType;
        this.desc = desc;
        this.children = []; // children list of DataSections; fine grained description
    }

    readData(offset = this.offset, size = this.size) {
        // check data
        if (offset > this.offset + this.size ||
            size > this.size ||
            offset + size > this.offset + this.size) {
                throw "Out of bounds read!";
            } 
        
        // open image
        let fd = fs.openSync(this.imgPath, 'r');
        let rBuf = Buffer.alloc(size);
        let numRead = fs.readSync(fd, rBuf, 0, size, offset);
        fs.closeSync(fd);
        if (numRead == size) {
            //console.log("Sucessfully read:", numRead, "bytes.");
            return rBuf;
        } 
        else {
            console.log("Error while reading ", imgPath);
            throw "Read error";
        }
    }

    get value() {
        return this.valueType(this.readData());
    }

}

function hexArray(data) {
/*     let rawStr = "[";
    let values = "";
    let elem;
    for (elem of data) {
        values += elem;
        values += ", ";
    }
    if (values.length > 0) {
        values = values.slice(0, -2);
    }
    rawStr += values;
    rawStr += "]";
    return rawStr; */
    let ar = [];
    for (const elem of data) {
        ar.push(("00" + elem.toString(16).toUpperCase()).slice(-2));
    }
    return ar;
}

function ascii(data) {
    let retStr = "";
    for (const d of data) {
        retStr += String.fromCharCode(d);
    }
    return retStr;
}

function utf16(data) {
    if (data.length % 2 !== 0) {
        throw `Odd length of byte array when parsing UTF-16 encoding.`;
    }
    let utf16Str = "";
    for (let i = 0; i < data.length; i += 2) {
        utf16Str += String.fromCharCode(uintLE(data.slice(i, i + 2)));
    }
    return utf16Str;
}

function guid(data) {
    if (data.length != 16) {
        throw `Parsing GUID: Wrong size: ${data.length}; Expected: 16`;
    }
    let guidStr = "";
    
    // extract bytes [0,3]
    data.slice(0, 4).reverse().forEach(d => {
        guidStr += ("00" + d.toString(16).toUpperCase()).slice(-2);
    });
    guidStr += "-";

    // extract bytes [4,5]
    data.slice(4, 6).reverse().forEach(d => {
        guidStr += ("00" + d.toString(16).toUpperCase()).slice(-2);
    });
    guidStr += "-";

    // extract bytes [6,7]
    data.slice(6, 8).reverse().forEach(d => {
        guidStr += ("00" + d.toString(16).toUpperCase()).slice(-2);
    });
    guidStr += "-";

    // extract bytes [8,9]
    data.slice(8, 10).forEach(d => {
        guidStr += ("00" + d.toString(16).toUpperCase()).slice(-2);;
    });
    guidStr += "-";

    // extract bytes [10,15]
    data.slice(10, 16).forEach(d => {
        guidStr += ("00" + d.toString(16).toUpperCase()).slice(-2);
    });

    return guidStr;
}

function uintLE(data) {
    // reverse array
    let revData = data.slice();
    revData.reverse()
    // call uintBE(data)
    return uintBE(revData);
}

function uintBE(data) {
    let val = 0;
    let elem = 0;
    for (elem of data) {
        val = val * 256;
        val += elem;
    }
    return val;
}