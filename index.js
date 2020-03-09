'use strict';

let fs = require("fs");
let util = require("util");

function onLoadImage() {
    let imgPath = document.getElementById("imgPath").value;
    let sectorSize =  parseInt(document.getElementById("sectorSize").value);
    console.log("Loading image:", imgPath);
    // let p1 = new PartInfo("MBR", 0, 1);
    // let p2 = new PartInfo("Lul", 1, 1337);
    // let p3 = new PartInfo("Rofl", 1338, 114);
    // let partList = document.getElementById("partList");
    // partList.appendChild(createPartitionElement(p1));
    // partList.appendChild(createPartitionElement(p2));
    // partList.appendChild(createPartitionElement(p3));
    
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
    // MBR sucessfully parsed
    let partList = document.getElementById("partList");
    partList.appendChild(createPartitionElement(mbr, sectorSize));

    // check if disk has GPT

    // analyze paritions
    let i = 1;
    for (const p of mbr.partitionList) {
        if (p.numSectors > 0) {
            let pDs = new DataSection(imgPath, p.startLBA*sectorSize, p.numSectors*sectorSize, `Partition #${i++}`, hexArray, "First Partition");
            partList.appendChild(createPartitionElement(pDs, sectorSize));
            // check if any filesystem is on partition

            // if yes, then parse filesystem
        }
    }

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
    mbr.children.push(addPartitionEntry(new DataSection(imgPath, 446, 16, "Partition Entry #1", hexArray, "")));
    mbr.children.push(addPartitionEntry(new DataSection(imgPath, 462, 16, "Partition Entry #2", hexArray, "")));
    mbr.children.push(addPartitionEntry(new DataSection(imgPath, 478, 16, "Partition Entry #3", hexArray, "")));
    mbr.children.push(addPartitionEntry(new DataSection(imgPath, 494, 16, "Partition Entry #4", hexArray, "")));
    mbr.children.push(new DataSection(imgPath, 510, 2, "Signature", uintBE,  "The signature"));

    return mbr;
};

function tryParseGpt(imgPath, sectorSize) {
    let mbr = tryParseMbr(imgPath);
    // check if only one partition is used (protective mbr)
    let numPart = 0;
    mbr.partitionList.forEach(p => {
        if (p.numSectors > 0 ) {
            numPart++;
        }
    });
    if (numPart != 1 || p[0].partType != 0xEE) {
        throw "Protective MBR invalid!";
    }
    // Protective MBR is valid; Try to parse GPT header
    let gptHeader = createGptHeaderTemplate(imgPath, sectorSize);
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
    // check CRC32


}

function createGptHeaderTemplate(imgPath, sectorSize) {
    let sectorOffset = sectorSize*1;
    let gptHeader = new DataSection(imgPath, sectorOffset, sectorSize*1, "GPT Header", hexArray, "");
    gptHeader.children.push(new DataSection(imgPath, sectorOffset + 0, 8, "Signature", ascii, ""));
    gptHeader.children.push(new DataSection(imgPath, sectorOffset + 8, 4, "Revision", hexArray, ""));
    gptHeader.children.push(new DataSection(imgPath, sectorOffset + 12, 4, "Header size", uintLE, "in bytes"));
    gptHeader.children.push(new DataSection(imgPath, sectorOffset + 16, 4, "CRC32 of header", uintLE, ""));
    gptHeader.children.push(new DataSection(imgPath, sectorOffset + 20, 4, "Reserved", uintLE, "must be zero"));
    gptHeader.children.push(new DataSection(imgPath, sectorOffset + 24, 8, "Current LBA", uintLE, "location of this header copy"));
    gptHeader.children.push(new DataSection(imgPath, sectorOffset + 32, 8, "Backup LBA", uintLE, "location of the other header copy"));
    gptHeader.children.push(new DataSection(imgPath, sectorOffset + 40, 8, "First LBA for partitions", uintLE, ""));
    gptHeader.children.push(new DataSection(imgPath, sectorOffset + 48, 8, "Last usable LBA for paritions", uintLE, ""));
    gptHeader.children.push(new DataSection(imgPath, sectorOffset + 56, 16, "Disk GUID", hexArray, ""));
    gptHeader.children.push(new DataSection(imgPath, sectorOffset + 72, 8, "Start LBA of partition entries", uintLE, ""));
    gptHeader.children.push(new DataSection(imgPath, sectorOffset + 80, 4, "Number of partition entries", uintLE, ""));
    gptHeader.children.push(new DataSection(imgPath, sectorOffset + 84, 4, "Size of partition entry", uintLE, ""));
    gptHeader.children.push(new DataSection(imgPath, sectorOffset + 88, 4, "CRC32 of partition entries array", uintLE, ""));
    gptHeader.children.push(new DataSection(imgPath, sectorOffset + 92, sectorSize-92, "Reserved", uintLE, "must be zeros"));
    return gptHeader;
}

function addPartitionEntry(ds) {
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
            console.log("Sucessfully read:", numRead, "bytes.");
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