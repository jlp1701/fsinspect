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
        partList.appendChild(createPartitionElement(mbr, sectorSize));
    
    } else {
        // GPT scheme
        let gptDisk = parseDiskWithGPT(imgPath, sectorSize);

        let partList = document.getElementById("partList");
        partList.appendChild(createPartitionElement(mbr, sectorSize));
        partList.appendChild(createPartitionElement(gptDisk.primaryGPT.header, sectorSize));
        partList.appendChild(createPartitionElement(gptDisk.primaryGPT.partitionList, sectorSize));
    
   /*      for (const p of gptDisk.partitions) {
            partList.appendChild(createPartitionElement(p, sectorSize));
        } */

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
        partitions.push(new DataSection(imgPath, p.offset, p.size, p.name, hexArray, ""));
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
    ds.children.push(new DataSection(imgPath, offset + 56, 72, "Partition name", hexArray, ""));
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

// analyze gpt scheme
function analyzeGpt(imgPath) {
    
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